// Only the paid model HTTP edge is fake; all clinical data uses public commands.
import assert from 'node:assert/strict'
import { clinic, pastVisit } from './clinic.mjs'
export const weakNote = {
  subjective: 'Knee stiffness after prolonged sitting.',
  objective: '40 minutes of exercise, mostly independent repetitions without skilled cueing. Charge entry requests 4 units.',
  assessment: 'Patient exercised independently; no skilled rationale recorded.',
  goals: 'Return to walking 30 minutes.', plan: 'Continue exercises.',
}
export const strongNote = {
  ...weakNote, objective: '40 minutes of one-on-one skilled therapeutic exercise: tactile cueing and graded loading adjusted after each set for knee valgus and pain.',
  assessment: 'Skilled load adjustment and tactile correction required to improve safe stair descent; independent exercise cannot yet maintain alignment.',
}
export function modelEdge() {
  const seen = [], control = { mode: 'normal', during: null }
  const outbound = async request => {
    const body = await request.json(); seen.push(body)
    const content=body.messages.find(m=>m.role==='user').content
    const user = JSON.parse(content.startsWith('{') ? content : '{}')
    const response=value=>Response.json(request.headers.has('x-api-key')?{content:[{type:'text',text:JSON.stringify(value)}]}:{choices:[{message:{content:JSON.stringify(value)}}]})
    if (!user.facts) return response({ sections: { subjective: 'Synthetic sample.', objective: '', assessment: '', goals: '', plan: '' }, charges: [{ code:'97110',minutes:23 },{ code:'97140',minutes:10 }], note:'' })
    if (control.during) await control.during()
    if (control.mode === 'unreachable') return Response.json({ error: 'Provider unavailable' },{status:503})
    const findings = user.facts.note.body.includes('mostly independent') ? [
      { kind:'units',question:'The narrative documents 40 minutes, supporting 3 CMS timed units; the 60 charge minutes produce 4. Review the unsupported fourth unit.',evidence:weakNote.objective,ruleIds:['cms.time'] },
      { kind:'skilled_need',question:'The note describes independent activity without explaining a skilled need. Review the supporting plan and document the skilled service actually provided.',evidence:weakNote.assessment,ruleIds:['cms.skilled'] },
    ] : []
    if (user.facts.alerts.some(a=>a.kind==='progress')) findings.push({kind:'progress',question:'Review the missing progress report after ten treatment days.',evidence:user.facts.alerts.find(a=>a.kind==='progress').message,ruleIds:['cms.progress']})
    if (control.mode==='ungrounded') findings.push({kind:'payer',question:'Invented requirement.',evidence:weakNote.assessment,ruleIds:['invented.rule']})
    if (control.mode==='invented-evidence') findings.push({kind:'payer',question:'Invented observation.',evidence:'Patient has an invented symptom.',ruleIds:['cms.skilled']})
    return response({findings})
  }
  return {seen,control,outbound}
}
export async function defensibilityClinic(h) {
  await h.finishSetup()
  const {service,practitioners:[priya,sam]}=await clinic(h,['Priya','Sam'])
  await h.cmd('staff.save',{id:priya.id,name:'Priya',email:priya.email,role:'practitioner',credentials:'PT',active:true})
  const reception=await h.staff('Rosa','reception')
  const patient=await h.cmd('client.save',{firstName:'Elena',lastName:'Martinez',dateOfBirth:'1971-09-22'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  const payer=await h.cmd('insurance.payer.save',{name:'Medicare therapy',payerId:'MEDICARE',receiverId:'CMS',unitMethod:'cms',medicare:true})
  const year=new Date().getUTCFullYear()
  await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'BENEFICIARY',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:`${year}-01-01`})
  await h.cmd('documentation.payer.save',{payerId:payer.id,required:['totalTreatmentMinutes','assessment']})
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:'pt.daily',sections:weakNote,charges:[{code:'97110',minutes:60}]},priya.cookie)
  const date=(await h.state()).appointments.find(a=>a.id===visit).start_at.slice(0,10)
  const plan=await h.cmd('plan.send',{clientId:patient.id,noteId:note.id,diagnoses:'Knee pain',shortTermGoals:'Walk 30 minutes',longTermGoals:'Return to hiking',frequencyPerWeek:2,durationWeeks:6,interventions:'Therapeutic exercise; progress skilled need by response.',startDate:date,physicianName:'Anika Patel',physicianEmail:'apatel@referrer.example',signature:'Priya',attest:true},priya.cookie)
  const file=async(cookie=priya.cookie)=>{const r=await h.send('/api/balm/clients/'+patient.id,undefined,cookie);assert.equal(r.status,200,r.text);return r.value}
  return {service,priya,sam,reception,patient,visit,payer,note,plan,file,path:'/app/clients/'+patient.id}
}
