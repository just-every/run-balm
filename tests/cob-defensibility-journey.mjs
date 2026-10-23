// AGENT-003 inherited by INS-013: all clinical setup and stale edits go through
// public commands. The paid model HTTP boundary is the only fake.
import assert from 'node:assert/strict'
import {harness} from './harness.mjs'
import {defensibilityClinic,modelEdge,strongNote} from './defensibility-clinic.mjs'

export async function cobDefensibilityJourney(h,edge) {
 const c=await defensibilityClinic(h),year=new Date().getUTCFullYear()
 const secondaryInput={name:'Harbor Mutual',payerId:'HARBOR',receiverId:'HARBOR',unitMethod:'ama'}
 const secondary=await h.cmd('insurance.payer.save',secondaryInput)
 const tertiary=await h.cmd('insurance.payer.save',{name:'Valley Benefits',payerId:'VALLEY',receiverId:'VALLEY',unitMethod:'fixed',fixedUnitMinutes:15})
 const policyInput={clientId:c.patient.id,memberId:'synthetic-balm-2',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:`${year}-01-01`}
 const secondaryPolicy=await h.cmd('insurance.policy.save',{...policyInput,payerId:secondary.id,priority:2})
 const tertiaryPolicy=await h.cmd('insurance.policy.save',{...policyInput,payerId:tertiary.id,priority:3})
 await h.cmd('documentation.payer.save',{payerId:secondary.id,required:['goals']})
 await h.cmd('documentation.payer.save',{payerId:tertiary.id,required:['assessment']})
 await h.cmd('note.amend',{id:c.note.id,revision:1,sections:strongNote,charges:[{code:'97110',minutes:8},{code:'97140',minutes:8,cmsTieChosen:true}],totalTreatmentMinutes:16,totalTimedMinutes:16},c.priya.cookie)
 await h.cmd('scribe.save',{provider:'anthropic',key:'synthetic-balm-1'})
 const input={id:c.note.id,revision:2},check=(status=200)=>h.cmd('note.check',input,c.priya.cookie,status)
 await check()
 const sent=JSON.parse(edge.seen.at(-1).messages.find(m=>m.role==='user').content),payers=sent.facts.payers
 assert.equal(sent.facts.payer.name,'Medicare therapy','legacy primary payer facts remain primary')
 assert.equal(sent.facts.billed.reduce((t,l)=>t+l.units,0),1)
 assert.deepEqual(payers.map(p=>[p.priority,p.method,p.billed.reduce((t,l)=>t+l.units,0)]),[[1,'cms',1],[2,'ama',2],[3,'fixed',0]])
 assert.equal(payers[1].policyId,secondaryPolicy.id);assert.equal(payers[2].policyId,tertiaryPolicy.id)
 assert.ok(payers.every(p=>Number.isInteger(p.policyVersion)&&Number.isInteger(p.payerVersion)&&Number.isInteger(p.documentationVersion)))
 assert.ok(sent.rules.some(r=>r.id==='payer.configuration.'+secondaryPolicy.id&&r.rule.includes('Goals')))
 assert.ok(sent.rules.some(r=>r.id==='payer.configuration.'+tertiaryPolicy.id&&r.rule.includes('Assessment')))
 assert.ok(sent.rules.some(r=>r.id==='cob.billing'))
 assert.ok(!JSON.stringify(sent).includes('BENEFICIARY')&&!JSON.stringify(sent).includes('synthetic-balm-2'))
 const current=await check(),saved=async()=>(await c.file()).notes.find(n=>n.id===c.note.id).defensibility
 for(const change of [
  ()=>h.cmd('documentation.payer.save',{payerId:secondary.id,required:['goals','assessment']}),
  ()=>h.cmd('insurance.payer.save',{id:secondary.id,...secondaryInput,unitMethod:'cms'}),
  ()=>h.cmd('insurance.policy.save',{id:tertiaryPolicy.id,...policyInput,payerId:tertiary.id,priority:3,startsOn:`${year-1}-01-01`,endsOn:`${year-1}-12-31`}),
  ()=>h.cmd('insurance.policy.save',{...policyInput,payerId:tertiary.id,priority:3}),
 ]){
  edge.control.during=async()=>{edge.control.during=null;await change()}
  const refused=await check(409);assert.match(refused.code,/note_or_rules_changed_recheck/)
  assert.equal((await saved()).checkedAt,current.checkedAt,'stale result cannot replace the last completed review')
 }
 await check()
 return {c,secondary,secondaryPolicy,tertiary,tertiaryPolicy}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const edge=modelEdge(),h=await harness({outbound:edge.outbound})
 try{await cobDefensibilityJourney(h,edge);console.log('INS-013 / AGENT-003 payer-scoped grounded review passed')}finally{await h.close()}
}
