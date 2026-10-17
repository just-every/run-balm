// Patient payment commands and the state the pages read. Every command resolves
// the live actor and enforces its role here; writes re-check authority in their
// own D1 batch (domain/model commit). Stripe calls use the clinic's sealed key.
import { visibleAppointment } from '../domain/booking'
import { clientVisible } from '../domain/clients'
import { audit, commit, guard, human, insist, need, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { smsBlock, type SmsEnv } from '../sms'
import { liveCard, removeCard } from './cards'
import { chargeCardOnFile } from './charges'
import { saveVisitCodes, savePractitionerNpi, visitCodes } from './codes'
import { connectStripe, disconnectStripe, stripeView } from './connect'
import { superbillFacts } from './documents'
import { ledger, openInvoices, parseDollars } from './ledger'
import { createLink } from './links'

const deskRole = (who: Actor) => who.role === 'owner' || who.staffRole === 'reception'
const clinicName = async (db: D1Database) => (await one(db, 'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name as string

async function saveCopay(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const client = await clientVisible(db, who, input.clientId)
  const typed = String(input.copay ?? '').trim()
  const cents = typed === '' ? null : parseDollars(typed, 'copay')
  insist(cents === null || cents <= 1_000_000, 'invalid_copay')
  await commit(db, who, [stmt(db, 'UPDATE bm_clients SET copay_cents=?,version=version+1 WHERE id=?', cents, client.id), audit(db, who, 'client.copay_saved', client.id as string, client.id as string, cents === null ? 'cleared' : `${cents} cents`)])
  return { clientId: client.id, copayCents: cents }
}

async function chargeCopay(env: SmsEnv, db: D1Database, who: Actor, visit: Data) {
  need(who, 'owner', 'reception'); human(who)
  const client = await one(db, 'SELECT copay_cents FROM bm_clients WHERE id=?', visit.client_id)
  insist(Number(client?.copay_cents) > 0, 'set_the_patient_copay_in_their_file_first', 409)
  return chargeCardOnFile(env, db, who, { clientId: visit.client_id, amountCents: Number(client!.copay_cents), kind: 'copay', appointmentId: visit.id, description: `Copay at ${await clinicName(db)}` })
}

/** Check a patient in on the day of the visit; with `charge`, the copay goes on their card in the same action. */
async function checkIn(env: SmsEnv, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const visit = await visibleAppointment(db, who, input.appointmentId)
  insist(visit.status === 'booked', 'only_a_booked_visit_can_be_checked_in', 409)
  insist(!visit.checked_in_at, 'already_checked_in', 409)
  insist(Math.abs(Date.parse(visit.start_at as string) - Date.now()) < 12 * 3600_000, 'check_in_on_the_day_of_the_visit', 409)
  await commit(db, who, [
    stmt(db, "UPDATE bm_appointments SET checked_in_at=?,checked_in_by=?,version=version+1 WHERE id=? AND status='booked' AND checked_in_at IS NULL", new Date().toISOString(), who.email, visit.id), guard(db, 'changes()=1'),
    audit(db, who, 'appointment.checked_in', visit.client_id as string, visit.id as string),
  ])
  const copay = input.charge === 'on' || input.charge === true ? await chargeCopay(env, db, who, visit) : null
  return { appointmentId: visit.id, checkedIn: true, copay }
}

async function chargeInvoice(env: SmsEnv, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const invoice = await one(db, "SELECT * FROM bm_invoices WHERE id=? AND status='approved'", text(input.invoiceId, 'invoice', 100))
  insist(invoice, 'approved_invoice_not_found', 404)
  const open = (await openInvoices(db, invoice.client_id as string)).find(i => i.id === invoice.id)
  insist(open, 'there_is_no_patient_balance_to_charge_check_insurance_status', 409)
  return chargeCardOnFile(env, db, who, { clientId: invoice.client_id as string, amountCents: open.open_cents, kind: 'charge', invoiceId: invoice.id as string, description: `Payment to ${await clinicName(db)}` })
}

export async function paymentCommand(env: SmsEnv, db: D1Database, who: Actor, name: string, input: Data) {
  insist(who.role !== 'agent', 'agents_can_only_prepare', 403)
  switch (name) {
    case 'pay.stripe.connect': return connectStripe(env, db, who, input)
    case 'pay.stripe.disconnect': return disconnectStripe(env, db, who)
    case 'pay.npi.save': return savePractitionerNpi(db, who, input)
    case 'pay.codes.save': return saveVisitCodes(db, who, input)
    case 'pay.copay.save': return saveCopay(db, who, input)
    case 'pay.link.create': return createLink(env, db, who, input)
    case 'pay.card.remove': return removeCard(env, db, who, input)
    case 'pay.checkin': return checkIn(env, db, who, input)
    case 'pay.copay.charge': {
      const visit = await visibleAppointment(db, who, input.appointmentId)
      insist(visit.checked_in_at || visit.status === 'attended', 'check_the_patient_in_first', 409)
      return chargeCopay(env, db, who, visit)
    }
    case 'pay.invoice.charge': return chargeInvoice(env, db, who, input)
  }
  insist(false, 'unknown_command', 404)
}

/** What the schedule and Clinic pages need: Stripe and text availability, and today's check-ins. */
export async function paymentsState(env: SmsEnv, db: D1Database, who: Actor) {
  if (who.role === 'agent') return {}
  const desk = deskRole(who), stripe = await stripeView(env, db)
  const today = await rows(db, `SELECT a.id,a.checked_in_at,c.copay_cents,cd.brand,cd.last4,
    (SELECT json_object('id',p.id,'status',p.status,'amount',p.amount_cents,'receipt',p.receipt_number,'failure',p.failure) FROM bm_card_payments p WHERE p.appointment_id=a.id AND p.kind='copay' ORDER BY p.created_at DESC LIMIT 1) AS copay
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id LEFT JOIN bm_cards cd ON cd.client_id=a.client_id AND cd.removed_at IS NULL
    WHERE a.start_at BETWEEN ? AND ? AND (? OR a.practitioner_id=?)`, new Date(Date.now() - 12 * 3600_000).toISOString(), new Date(Date.now() + 12 * 3600_000).toISOString(), desk ? 1 : 0, who.staffId ?? '')
  const visits = Object.fromEntries(today.map(v => [v.id, { checkedInAt: v.checked_in_at, ...(desk ? { copayCents: v.copay_cents, card: v.brand ? { brand: v.brand, last4: v.last4 } : null, copay: v.copay ? JSON.parse(v.copay as string) : null } : {}) }]))
  const npis = who.role === 'owner' ? await rows(db, "SELECT id,name,npi FROM bm_staff WHERE role='practitioner' AND erased_at IS NULL ORDER BY name") : []
  return { payments: { stripe: desk ? stripe : { block: stripe.block }, smsBlock: smsBlock(env), visits, npis } }
}

/** The billing part of a client file: codes for the visits this actor sees, and for the desk the ledger and card. */
export async function clientBilling(env: SmsEnv, db: D1Database, who: Actor, clientId: string) {
  const codes = await visitCodes(db, { clientId })
  if (!deskRole(who)) return { codes }
  const client = await one(db, 'SELECT copay_cents,email,phone FROM bm_clients WHERE id=?', clientId)
  const invoices = await rows(db, "SELECT id FROM bm_invoices WHERE client_id=? AND status='approved' ORDER BY number DESC LIMIT 24", clientId)
  const superbills = await Promise.all(invoices.map(async i => { const f = await superbillFacts(db, i.id as string); return { invoiceId: i.id, number: f.invoice.number, serviceDate: f.v.serviceDate, missing: f.missing } }))
  return {
    codes, copayCents: client?.copay_cents ?? null, hasEmail: !!client?.email, hasPhone: !!client?.phone,
    card: await liveCard(db, clientId), ledger: await ledger(db, clientId), open: await openInvoices(db, clientId), superbills,
    payments: await rows(db, 'SELECT id,kind,amount_cents,applied_cents,status,card_brand,card_last4,failure,receipt_number,receipt_delivery,created_at,succeeded_at FROM bm_card_payments WHERE client_id=? ORDER BY created_at DESC LIMIT 50', clientId),
    links: await rows(db, 'SELECT id,purpose,created_by,created_at,expires_at,delivery,delivery_result,opened_at FROM bm_pay_links WHERE client_id=? ORDER BY created_at DESC LIMIT 10', clientId),
    stripe: await stripeView(env, db), smsBlock: smsBlock(env),
  }
}
