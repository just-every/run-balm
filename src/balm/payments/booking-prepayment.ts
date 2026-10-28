import { patientCreationFence } from '../domain/hosting'
import type { Bindings } from '../../auth.server'
import { appointmentStatements, intakeToken, placementGuards } from '../domain/booking'
import { audit, commit, guard, id, insist, now, one, rows, sha256, stmt, type Data } from '../domain/model'
import { checkSelfService } from '../scheduling/self-service-policy'
import { stripeReady } from './connect'
import { customerFor } from './cards'
import { stripeCall } from './stripe-api'
import { receiptPdf } from './documents'
import { h, money } from '../ui/shared'

const actor={email:'booking payment',role:'patient'}
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}
const redirect=(location:string)=>new Response(null,{status:303,headers:{...headers,location}})
const html=async(body:string,status=200)=>(await import('../ui')).renderPublic('booking-payment',{body},status)

/** Attempted sessions keep holding the slot until Stripe confirms expiration or payment. */
export function bookingHoldGuard(db:D1Database,v:Data){
 return guard(db,`NOT EXISTS(SELECT 1 FROM bm_booking_payments WHERE state='reserved' AND (expires_at>? OR attempted_at IS NOT NULL) AND id<>? AND start_at<? AND end_at>? AND (practitioner_id=? OR (? IS NOT NULL AND room_id=?)))`,now(),v.reservationId??'',v.endAt,v.startAt,v.practitionerId,v.roomId??null,v.roomId??null)
}

export async function reserveBooking(env:Bindings,db:D1Database,service:Data,visit:Data,input:Data,visitor:Data,writes:D1PreparedStatement[]){
 const connected=await stripeReady(env,db)
 const amount=Number(service.prepay_mode==='full'?service.price_cents:service.deposit_cents)
 insist(input.confirmPayment===true||input.confirmPayment==='on','confirm_the_booking_payment_amount')
 insist(Number(input.confirmedAmountCents)===amount&&Number(input.serviceVersion)===Number(service.version),'booking_price_changed_review_the_amount',409)
 const clinic=await one(db,'SELECT clinic_name,address,abn,tax_id_type,practice_npi,time_zone FROM bm_settings WHERE id=1')
 const patientName={first_name:input.firstName,last_name:input.lastName}
 const {tokenHash,...frozenVisit}=visit
 const token=intakeToken(),reservationId=id(),paymentId=id(),at=now(),expires=new Date(Date.now()+15*60_000).toISOString()
 await commit(db,null,[...writes,...await placementGuards(db,visit as any),
  guard(db,'EXISTS(SELECT 1 FROM bm_stripe WHERE id=1 AND account_id=? AND connected_at=?)',connected.settings.account_id,connected.settings.connected_at),
  guard(db,'EXISTS(SELECT 1 FROM bm_services WHERE id=? AND version=? AND active=1)',service.id,service.version),
  guard(db,`EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND lower(email)=? AND erased_at IS NULL) AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)=1 AND NOT EXISTS(SELECT 1 FROM bm_guardian_grants WHERE email=? AND revoked_at IS NULL)`,visit.clientId,visitor.email,visitor.email,visitor.email),
  stmt(db,`INSERT INTO bm_card_payments(id,client_id,kind,amount_cents,status,created_by,created_at,updated_at) VALUES(?,?,'charge',?,'open',?,?,?)`,paymentId,visit.clientId,amount,visitor.email,at,at),
  stmt(db,`INSERT INTO bm_booking_payments(id,client_id,payment_id,appointment_id,practitioner_id,service_id,room_id,start_at,end_at,price_cents,amount_cents,mode,visit_json,receipt_facts,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,reservationId,visit.clientId,paymentId,visit.id,visit.practitionerId,visit.serviceId,visit.roomId,visit.startAt,visit.endAt,service.price_cents,amount,service.prepay_mode,JSON.stringify(frozenVisit),JSON.stringify({clinic,patient:patientName}),at,expires),
  stmt(db,'INSERT INTO bm_booking_payment_tokens(id,token_hash) VALUES(?,?)',reservationId,await sha256(token)),
  audit(db,visitor as any,'booking.payment_reserved',visit.clientId,reservationId,`${amount} cents explicitly confirmed; ${service.prepay_mode}`),
 ])
 return token
}

/** Reserve before the provider write. Retries use the exact frozen payload and key. */
async function startCheckout(env:Bindings,db:D1Database,b:Data,authority:D1PreparedStatement[]=[]){
 const hosting=await patientCreationFence(db,env)
 const p=(await one(db,'SELECT * FROM bm_card_payments WHERE id=?',b.payment_id))!
 if(b.checkout_url){await commit(db,null,[...authority,hosting]);return b.checkout_url as string}
 insist(b.state==='reserved'&&(b.attempted_at||Date.parse(b.expires_at)>Date.now()),'booking_reservation_expired',409)
 insist(!b.attempted_at||Date.now()-Date.parse(b.attempted_at)<23*3600_000,'payment_outcome_needs_clinic_review',409)
 const {settings,key}=await stripeReady(env,db)
 await commit(db,null,[...authority,hosting])
 // Customer creation has its own durable idempotency key. A concurrent caller uses the same customer.
 const customer=p.stripe_customer_id??await customerFor(db,key,settings.account_id as string,b.client_id)
 await commit(db,null,[...authority,hosting,
  guard(db,'EXISTS(SELECT 1 FROM bm_stripe WHERE id=1 AND account_id=? AND connected_at=?)',settings.account_id,settings.connected_at),
  guard(db,"EXISTS(SELECT 1 FROM bm_booking_payments WHERE id=? AND state='reserved' AND (expires_at>? OR attempted_at IS NOT NULL))",b.id,now()),
  guard(db,'NOT EXISTS(SELECT 1 FROM bm_card_payments WHERE id=? AND stripe_account_id IS NOT NULL AND stripe_account_id<>?)',p.id,settings.account_id),
  stmt(db,'UPDATE bm_card_payments SET stripe_customer_id=?,stripe_account_id=? WHERE id=?',customer,settings.account_id,p.id),
  stmt(db,'UPDATE bm_booking_payments SET attempted_at=COALESCE(attempted_at,?),checkout_expires_at=COALESCE(checkout_expires_at,?) WHERE id=?',now(),new Date(Date.now()+31*60_000).toISOString(),b.id),
 ])
 const frozen=(await one(db,'SELECT checkout_expires_at FROM bm_booking_payments WHERE id=?',b.id))!
 const session=await stripeCall(key,'POST','/checkout/sessions',{
  mode:'payment',customer,allowed_payment_method_types:['card'],client_reference_id:p.id,
  expires_at:Math.floor(Date.parse(frozen.checkout_expires_at)/1000),
  line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:b.amount_cents,product_data:{name:'Clinic booking payment'}}}],
  metadata:{balm_payment:p.id,balm_client:b.client_id},payment_intent_data:{metadata:{balm_payment:p.id,balm_client:b.client_id}},
  success_url:env.AUTH_ORIGIN+'/portal/home',cancel_url:env.AUTH_ORIGIN+'/portal/home',
 },`balm-booking-${p.id}`)
 insist(typeof session.url==='string'&&session.url.startsWith('https://checkout.stripe.com/'),'invalid_checkout_url',409)
 await commit(db,null,[stmt(db,'UPDATE bm_card_payments SET checkout_session=? WHERE id=? AND checkout_session IS NULL',session.id,p.id),stmt(db,'UPDATE bm_booking_payments SET checkout_url=? WHERE id=?',session.url,b.id)])
 return session.url as string
}

/** A signed event can locate a lost session; authenticated provider facts bind it to the reservation. */
export async function syncBookingCheckout(env:Bindings,db:D1Database,paymentId:string,intentId?:string,checkoutSessionId?:string):Promise<Data|null>{
 const b=await one(db,'SELECT * FROM bm_booking_payments WHERE payment_id=?',paymentId),p=await one(db,'SELECT * FROM bm_card_payments WHERE id=?',paymentId)
 if(!b||!p||p.status==='succeeded')return p
 const {settings,key}=await stripeReady(env,db)
 insist(p.stripe_account_id===settings.account_id,'original_stripe_account_must_be_connected',409)
 let intent:Data|null=null
 const sessionId=p.checkout_session??checkoutSessionId
 if(sessionId){
  insist(b.attempted_at&&(!checkoutSessionId||checkoutSessionId===sessionId),'booking_checkout_mismatch',409)
  const session=await stripeCall(key,'GET',`/checkout/sessions/${encodeURIComponent(sessionId)}`,{expand:['payment_intent.latest_charge']})
  insist(session.id===sessionId&&session.mode==='payment'&&session.customer===p.stripe_customer_id&&session.metadata?.balm_payment===p.id&&session.metadata?.balm_client===b.client_id,'booking_checkout_mismatch',409)
  await commit(db,null,[
   guard(db,'EXISTS(SELECT 1 FROM bm_stripe WHERE id=1 AND account_id=? AND connected_at=?)',settings.account_id,settings.connected_at),
   guard(db,'EXISTS(SELECT 1 FROM bm_card_payments WHERE id=? AND stripe_account_id=? AND stripe_customer_id=? AND (checkout_session IS NULL OR checkout_session=?))',p.id,settings.account_id,p.stripe_customer_id,sessionId),
   stmt(db,'UPDATE bm_card_payments SET checkout_session=? WHERE id=? AND checkout_session IS NULL',sessionId,p.id),
  ])
  if(session.status==='expired'){
   await commit(db,null,[guard(db,"EXISTS(SELECT 1 FROM bm_card_payments WHERE id=? AND status<>'succeeded')",p.id),stmt(db,"UPDATE bm_card_payments SET status='expired',updated_at=? WHERE id=?",now(),p.id),stmt(db,"UPDATE bm_booking_payments SET state='closed' WHERE id=? AND state='reserved'",b.id),audit(db,actor,'booking.payment_expired',b.client_id,b.id)])
   return one(db,'SELECT * FROM bm_card_payments WHERE id=?',p.id)
  }
  intent=typeof session.payment_intent==='object'?session.payment_intent:null
 }else if(intentId){intent=await stripeCall(key,'GET',`/payment_intents/${encodeURIComponent(intentId)}`,{expand:['latest_charge']})}
 if(intent?.status==='succeeded')return recordBookingSucceeded(env,db,p,intent)
 return p
}

export async function recordBookingSucceeded(env:Bindings,db:D1Database,p:Data,intent:Data):Promise<Data>{
 const {settings}=await stripeReady(env,db)
 insist(p.stripe_account_id===settings.account_id&&p.stripe_customer_id,'original_stripe_account_must_be_connected',409)
 const b=(await one(db,'SELECT * FROM bm_booking_payments WHERE payment_id=?',p.id))!
 if((await one(db,'SELECT status FROM bm_card_payments WHERE id=?',p.id))?.status==='succeeded')return (await one(db,'SELECT * FROM bm_card_payments WHERE id=?',p.id))!
 insist(intent.status==='succeeded'&&intent.currency==='usd'&&Number(intent.amount_received)===Number(b.amount_cents)&&intent.customer===p.stripe_customer_id&&intent.metadata?.balm_payment===p.id&&intent.metadata?.balm_client===b.client_id,'booking_payment_mismatch',409)
 const v={...JSON.parse(b.visit_json),tokenHash:await sha256(intakeToken())},card=intent.latest_charge?.payment_method_details?.card
 let review:string|null=b.state==='reserved'?null:'Reservation already closed; payment needs human review'
 let placing:D1PreparedStatement[]=[]
 try{
  insist(!review&&Date.parse(b.start_at)>Date.now(),'booking_time_unavailable',409)
  const eligible=await checkSelfService(db,{clientId:b.client_id,practitionerId:b.practitioner_id,serviceId:b.service_id,startAt:b.start_at})
  placing=[...eligible.guards,...await appointmentStatements(db,actor,{...v,reservationId:b.id})]
 }catch{review='Payment received but the booking no longer meets current clinic rules'}
 const post=async()=>commit(db,null,[
  guard(db,"EXISTS(SELECT 1 FROM bm_card_payments WHERE id=? AND status<>'succeeded')",p.id),
  ...(!review?placing:[]),
  stmt(db,`UPDATE bm_card_payments SET status='succeeded',payment_intent=?,appointment_id=?,receipt_number=(SELECT COALESCE(MAX(receipt_number),0)+1 FROM bm_card_payments),card_brand=?,card_last4=?,succeeded_at=?,updated_at=? WHERE id=?`,intent.id,review?null:b.appointment_id,card?.brand??null,card?.last4??null,now(),now(),p.id),
  stmt(db,'UPDATE bm_booking_payments SET state=?,review_reason=? WHERE id=?',review?'review':'booked',review,b.id),
  audit(db,actor,review?'booking.payment_review':'booking.payment_fulfilled',b.client_id,b.id,`${b.amount_cents} cents; provider confirmed`),
 ])
 try{await post()}catch(error){
  if((await one(db,'SELECT status FROM bm_card_payments WHERE id=?',p.id))?.status!=='succeeded'){
   if(review)throw error
   review='Payment received but the slot or clinic authority changed; staff must review. No refund is sent automatically.'
   await post()
  }
 }
 await receiptPdf(db,p.id)
 return (await one(db,'SELECT * FROM bm_card_payments WHERE id=?',p.id))!
}

export async function bookingPaymentResponse(request:Request,env:Bindings):Promise<Response>{
 const {takeAddressRate,takePatientRate}=await import('../public-rates')
 const url=new URL(request.url),token=url.pathname.slice('/book/payment/'.length),db=env.DB
 if(request.method==='POST'&&request.headers.get('origin')!==env.AUTH_ORIGIN)return html('<h1>Cross-site request refused</h1>',403)
 if(!await takeAddressRate(env,request,'payment'))return html('<h1>Too many requests</h1>',429)
 const b=/^[A-Za-z0-9_-]{32}$/.test(token)?await one(db,'SELECT b.* FROM bm_booking_payments b JOIN bm_booking_payment_tokens t ON t.id=b.id WHERE t.token_hash=?',await sha256(token)):null
 if(!b)return html('<h1>This booking link is unavailable</h1>',404)
 const tokenExpiry=b.attempted_at?Date.parse(b.attempted_at)+24*3600_000:Date.parse(b.expires_at)
 if(Date.now()>=tokenExpiry)return html('<h1>This booking link has expired</h1><p>Open your signed-in patient portal or contact the clinic to check the original payment.</p><a href="/portal">Open patient portal</a>',410)
 const client=await one(db,'SELECT id,email FROM bm_clients WHERE id=? AND erased_at IS NULL',b.client_id)
 if(!client)return html('<h1>This booking link is unavailable</h1>',404)
 if(!await takePatientRate(env,'payment',client as any))return html('<h1>Too many requests</h1>',429)
 let error=''
 try{
  const p=await one(db,'SELECT * FROM bm_card_payments WHERE id=?',b.payment_id)
  if(p?.checkout_session)await syncBookingCheckout(env,db,b.payment_id)
  const current=(await one(db,'SELECT * FROM bm_booking_payments WHERE id=?',b.id))!
  if(current.state==='booked')return html('<h1>Your appointment is booked</h1><p>Your payment was confirmed once. Open your patient portal for the visit, intake and fixed payment receipt.</p><a href="/portal">Open patient portal</a>')
  if(current.state==='review')return html('<h1>Your payment needs clinic review</h1><p>Payment was received, but your appointment could not be confirmed. Contact the clinic. No refund is sent automatically.</p><a href="/portal">Open patient portal</a>')
  if(current.state==='closed'||(!b.attempted_at&&Date.parse(b.expires_at)<=Date.now()))return html('<h1>This reservation has expired</h1><p>No booking is confirmed. <a href="/book">Choose another time</a>.</p>')
  if(request.method==='POST')return redirect(await startCheckout(env,db,current))
 }catch(e){error='Payment could not be confirmed. Keep this link and contact the clinic if needed. An uncertain payment is never charged with a new payment identity.'}
 return html(`<h1>Confirm your booking payment</h1>${error?`<p role="alert">${h(error)}</p>`:''}<p>${b.mode==='full'?'Full prepayment':'Deposit'}: <strong>${money(b.amount_cents)}</strong> toward a ${money(b.price_cents)} visit.</p><p>Your appointment is confirmed after the provider confirms payment. This reservation holds your time while Checkout is open. Closing Checkout does not confirm a visit.</p><form method="post"><button type="submit">Continue to secure payment</button></form><p><a href="${h(url.pathname)}">Check payment status</a></p>`)
}

export async function portalBookingPayment(env:Bindings,patient:import('../portal/auth').Patient,input:Data){
 const {portalGuard}=await import('../portal/auth')
 const b=await one(env.DB,"SELECT * FROM bm_booking_payments WHERE id=? AND client_id=? AND state='reserved'",String(input.id??''),patient.clientId)
 insist(b,'booking_payment_not_found',404)
 return {redirect:await startCheckout(env,env.DB,b,[portalGuard(env.DB,patient),audit(env.DB,actor,'booking.payment_portal_opened',patient.clientId,b.id)])}
}
export async function patientBookingPayments(env:Bindings,clientId:string){
 const pending=await rows(env.DB,"SELECT b.payment_id,p.checkout_session FROM bm_booking_payments b JOIN bm_card_payments p ON p.id=b.payment_id WHERE b.client_id=? AND b.state='reserved' AND p.checkout_session IS NOT NULL",clientId)
 for(const p of pending)try{await syncBookingCheckout(env,env.DB,p.payment_id)}catch{/* An unavailable provider never confirms a booking. */}
 return rows(env.DB,'SELECT id,state,mode,amount_cents,price_cents,start_at,appointment_id,payment_id FROM bm_booking_payments WHERE client_id=? ORDER BY created_at DESC',clientId)
}
