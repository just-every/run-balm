import assert from 'node:assert/strict'
import {randomUUID,webcrypto} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {harness} from './harness.mjs'
import {createProtocol,errorCode} from '../src/modules/agent-door/conformance/protocol.mjs'
import {signJws,seconds,heldPolicy} from '../src/modules/agent-door/conformance/crypto.mjs'

/** Real native sessions, signed company policy and public MCP/person doors. */
export default async function configurationDoorJourney(report=()=>{}) {
const origin='https://127.0.0.1:43121',issuer='https://native-door-probe.invalid',installationId=randomUUID(),kid=randomUUID(),business='native-door-probe',sub='native-door-owner',email='owner@clinic.example'
const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
const publicKeys={[kid]:{...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256',use:'sig'}}
const h=await harness({entry:'tests/agent-door-worker.ts',origin,auth:{RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),RER_BUSINESS_TRUST:JSON.stringify({v:1,issuer,audience:origin,subject:installationId,email,keys:publicKeys})}})
try {
 await h.cmd('settings.save',{clinicName:'Native Receipt Clinic',timeZone:'America/New_York',taxId:'98-7654321',taxIdType:'EIN',bookingOpen:false})
 await h.finishSetup()
 const iat=seconds(),settings=await signJws(pair.privateKey,kid,'rer-business-settings+jwt',{v:1,iss:issuer,aud:origin,sub:installationId,business,email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev:1,values:{},logo:null,team:null})
 assert.equal((await h.send('/api/rer/business-settings',{settings})).status,200)
 const c=createProtocol({fetch:(url,init)=>h.mf.dispatchFetch(url,init),origin,surface:JSON.parse(await readFile('agent-surface.json','utf8')),signer:{issuer,installationId,kid,privateKey:pair.privateKey},person:{email,sub,cookie:h.owner},business,consent:randomUUID(),points:[],agentId:randomUUID(),seq:0,revision:0,listed:new Map()})
 await c.adopt(heldPolicy())
 const complete=async args=>{
  const pending=await c.tool('balm.clinic.update',args)
  assert.equal(pending.decision.disposition,'approval')
  assert.equal(pending.result.resultType,'input_required')
  const decision=await c.decideApproval(pending)
  assert.equal(decision.status,200)
  assert.equal(decision.body.approval.state,'executed',String(decision.body.approval.code))
  const done=await c.tool('balm.clinic.update',args,{requestState:pending.result.requestState})
  assert.equal(done.result.isError,false)
  assert.equal(done.decision.disposition,'approval')
  assert.ok(done.result._meta['com.runeditrun/receipt'])
  assert.deepEqual(done.decision.classes.map(x=>x.class).sort(),['sensitive','standard'])
  return {pending,done}
 }
 await complete({clinicName:'Native Receipt Clinic',taxId:'987-65-4321',taxIdType:'SSN',idempotency_key:randomUUID()})
 const clear={clinicName:'Native Receipt Clinic',taxId:'98-7654321',taxIdType:'EIN',idempotency_key:randomUUID()}
 const {pending,done}=await complete(clear)
 const snapshot=await h.state(),version=snapshot.settings.version
 const repeat=await c.tool('balm.clinic.update',clear)
 assert.deepEqual(repeat.result.structuredContent,done.result.structuredContent)
 assert.ok(repeat.result._meta['com.runeditrun/receipt'])
 assert.deepEqual(repeat.decision.classes,done.decision.classes)
 assert.equal((await h.state()).settings.version,version)
 report('PROBE held-tax-clear: /mcp balm.clinic.update -> pending; native approval HTTP 200 executed; retry approval standard+sensitive receipt=present; repeated retry unchanged version')
 const fresh=await c.tool('balm.clinic.update',{...clear,idempotency_key:randomUUID()})
 assert.equal(fresh.decision.disposition,'review')
 assert.deepEqual(fresh.decision.classes.map(x=>x.class),['standard'])
 assert.equal(fresh.result.isError,false)
 assert.ok(fresh.result._meta['com.runeditrun/review'])
 const reviewId=fresh.result._meta['com.runeditrun/review'].id
 const reviews=await c.personJson('/agents/api/reviews')
 assert.ok(reviews.reviews.some(x=>x.id===reviewId&&x.state==='open'))
 const marked=await c.personRequest('/agents/api/reviews/'+reviewId+'/reviewed',{method:'POST',body:'{}'})
 assert.equal(marked.status,200)
 assert.equal((await marked.json()).review.state,'reviewed')
 const audit=[],loadAudit=async()=>{let after;for(let i=0;i<100;i++){const page=await c.personJson('/agents/api/audit'+(after?'?after='+encodeURIComponent(after):''));assert.equal(page.differs_from_policy,0);audit.push(...page.rows);if(!page.rows.length||page.cursor===after)return;after=page.cursor}throw new Error('Audit pagination exceeded 100 pages')}
 await loadAudit()
 const retryRow=audit.find(x=>x.id===done.decision.id)
 assert.equal(retryRow.decision,'approval');assert.equal(retryRow.outcome,'replayed');assert.ok(retryRow.approval.by.length)
 const freshRow=audit.find(x=>x.id===fresh.decision.id)
 assert.equal(freshRow.decision,'review');assert.equal(freshRow.review.id,reviewId)
 assert.equal(audit.filter(x=>x.code==='review_required').length,0)
 report('PROBE review-115-path: held tax-clear replay audit -> approval/replayed with named approver, no review_required; fresh EIN write -> standard/review with real review row; native reviewed action HTTP 200')
 const conflict=await c.tool('balm.clinic.update',{...clear,clinicName:'Changed replay arguments'})
 assert.equal(errorCode(conflict),'idempotency_conflict')
 const events=await c.tool('balm.events.list',{limit:200})
 const changes=events.result.structuredContent.events.filter(x=>x.type==='balm.clinic.update')
 assert.equal(changes.length,3)
 assert.ok(changes.every(x=>x.actor.kind==='agent'&&x.uri==='balm://clinic/1'))
 const policy={...heldPolicy(),rules:[{id:'block',class:'*',do:'blocked'}]}
 await c.adopt(policy)
 const refused=await c.tool('balm.clinic.update',clear)
 assert.equal(errorCode(refused),'policy_blocked')
 assert.equal((await h.state()).settings.version,version+1)
 report('PROBE effects: /mcp balm.events.list -> 3 agent-attributed balm.clinic.update events for 3 actual writes at balm://clinic/1; saved retry and conflicting retry add none; changed-policy replay refused policy_blocked with unchanged state')
} finally {await h.close()}

}
