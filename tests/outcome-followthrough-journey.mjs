import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
import {portalLogin} from './portal-billing.mjs'

/** Real staff and patient doors; the harness substitutes only external network services. */
export async function outcomeFollowthroughJourney(h,onStage=async()=>{}){
 await h.finishSetup()
 const {service,practitioners:[priya,other]}=await clinic(h,['Priya','Other'])
 const desk=await h.staff('OutcomeDesk','reception')
 const patient=await h.cmd('client.save',{firstName:'Mara',lastName:'Outcome',email:'mara@patient.example'})
 await pastVisit(h,patient.id,priya,service.id)
 const knee=await h.cmd('episode.open',{clientId:patient.id,title:'Knee recovery',start:'direct_access'})
 const back=await h.cmd('episode.open',{clientId:patient.id,title:'Back recovery',start:'direct_access'})
 const exercise=await h.cmd('exercise.assign',{clientId:patient.id,title:'Knee extension',sets:2,reps:10,frequency:'Daily',instructions:'Follow your assigned dosage.'},priya.cookie)
 const excluded=await h.cmd('exercise.assign',{clientId:patient.id,title:'Separate back program',sets:2,reps:5,frequency:'Daily',instructions:'Separate episode dosage.'},priya.cookie)
 const formDraft=await h.cmd('intake.prepare',{title:'Episode PSFS',questions:[{id:'reason',label:'Reason',type:'short',required:false}],instruments:[{kind:'psfs',items:['Synthetic stairs task','Synthetic walking task']}]})
 const published=await h.cmd('intake.publish',{id:formDraft.id})
 const enrollment={clientId:patient.id,episodeId:knee.id,formId:published.id,exerciseIds:[exercise.id],checkins:true,cadenceDays:7,responseDays:0,maxCycles:2,consent:true,consentRecord:'Patient requested episode updates and one same-day follow-up, recorded by treating therapist.'}
 await h.cmd('outcome.enroll',enrollment,desk.cookie,403)
 await h.cmd('outcome.enroll',enrollment,other.cookie,404)
 await h.cmd('outcome.enroll',{...enrollment,consent:false},priya.cookie,400)
 const agent=await h.cmd('agent.create',{label:'Outcome refusal',scopes:['appointments.read']})
 const agentRead=await h.send('/api/balm/agent/command',{name:'outcome.read',input:{clientId:patient.id}},'',{authorization:'Bearer '+agent.token})
 assert.equal(agentRead.status,403)
 assert.ok(!agentRead.text.includes('Synthetic stairs task'))
 const schedule=await h.cmd('outcome.enroll',enrollment,priya.cookie)
 const request=await h.cmd('outcome.prepare',{id:schedule.id},priya.cookie)
 assert.equal((await h.cmd('outcome.prepare',{id:schedule.id},priya.cookie)).id,request.id)
 const read=()=>h.cmd('outcome.read',{clientId:patient.id},priya.cookie)
 let state=await read(),proposal=state.requests.find(r=>r.id===request.id).proposal
 const initialMail=h.mail.filter(m=>m.to.includes('mara@patient.example')).length
 assert.equal(initialMail,0)
 await h.cmd('outcome.approve',{id:request.id,digest:'stale',consent:true,consentRecord:'Confirmed'},priya.cookie,409)
 await h.cmd('outcome.approve',{id:request.id,digest:proposal.digest,consent:true,consentRecord:'Patient opted in for this request.'},desk.cookie,403)
 const approval={id:request.id,digest:proposal.digest,consent:true,consentRecord:'Patient opted in for this request.'}
 assert.equal((await h.cmd('outcome.approve',approval,priya.cookie)).state,'accepted')
 state=await read();proposal=state.requests.find(r=>r.id===request.id).proposal
 assert.equal(proposal.kind,'followup')
 // The shared cap counts the accepted initial attempt before allowing another contact.
 await h.cmd('outcome.approve',{...approval,digest:proposal.digest},priya.cookie,409)
 await h.cmd('followups.settings',{kind:'missed',enabled:false,delayDays:0,repeatDays:1,maxSends:1,contactLimit:2})
 assert.equal((await h.cmd('outcome.approve',{...approval,digest:proposal.digest},priya.cookie)).state,'accepted')
 await h.cmd('outcome.approve',{...approval,digest:proposal.digest},priya.cookie,409)
 assert.equal(h.mail.filter(m=>m.to.includes('mara@patient.example')).length,2)
 assert.ok(h.mail.filter(m=>m.to.includes('mara@patient.example')).every(m=>!m.text.includes('Knee')&&!m.text.includes('PSFS')&&!m.text.includes('Mara')))
 let missing=await h.cmd('outcome.brief',{episodeId:knee.id},priya.cookie)
 assert.ok(missing.openQuestions.some(q=>q.includes('no response')))
 const patientCookie=await portalLogin(h,'mara@patient.example'),filePath='/app/clients/'+patient.id
 await onStage({stage:'patient-request',h,patient,priya,patientCookie,filePath,knee,back})
 const page=await h.send('/portal/home',undefined,patientCookie)
 assert.equal(page.status,200,page.text);assert.match(page.text,/Synthetic stairs task/)
 const bad=await h.form('/portal/action',{name:'outcome.respond',id:request.id,q_out_psfs_1:'11',q_out_psfs_2:'6',adherence:'2',planned:'3'},patientCookie)
 assert.equal(bad.status,400)
 assert.equal((await h.form('/portal/action',{name:'exercise.done',id:exercise.id},patientCookie)).status,303)
 assert.equal((await h.form('/portal/action',{name:'exercise.done',id:excluded.id},patientCookie)).status,303)
 const revised=await h.cmd('intake.prepare',{title:'Revised episode PSFS',questions:[{id:'reason',label:'Reason',type:'short',required:false}],instruments:[{kind:'psfs',items:['Revised synthetic task']}]})
 await h.cmd('intake.publish',{id:revised.id})
 const response={name:'outcome.respond',id:request.id,q_out_psfs_1:'4',q_out_psfs_2:'6',adherence:'2',planned:'3',question:'Can we discuss stair confidence at our next visit?'}
 assert.equal((await h.form('/portal/action',response,patientCookie)).status,303)
 assert.equal((await h.form('/portal/action',response,patientCookie)).status,409)
 state=await read();assert.equal(state.requests.find(r=>r.id===request.id).proposal.blocked,'Response received')
 const brief=await h.cmd('outcome.brief',{episodeId:knee.id},priya.cookie)
 assert.equal(brief.scores[0].scores[0].score,5)
 assert.equal(brief.scores[0].formId,published.id)
 const foreign=await h.cmd('client.save',{firstName:'Una',lastName:'Private',email:'una@patient.example'})
 const foreignCookie=await portalLogin(h,'una@patient.example')
 assert.equal((await h.form('/portal/action',response,foreignCookie)).status,404)
 assert.equal(brief.checkins[0].adherence,2);assert.equal(brief.checkins[0].planned,3)
 assert.equal(brief.adherence.length,1);assert.equal(brief.adherence[0].loggedSessions,1)
 assert.ok(brief.citations.some(c=>c.kind==='response'&&c.id===brief.scores[0].responseId))
 assert.ok(brief.openQuestions.some(q=>q.includes('stair confidence')))
 assert.ok(!JSON.stringify(brief).includes('Separate back program'))
 await h.cmd('outcome.brief',{episodeId:knee.id},desk.cookie,403)
 await h.cmd('outcome.read',{clientId:patient.id},other.cookie,404)
 await onStage({stage:'clinician-brief',h,patient,priya,patientCookie,filePath,knee,back,brief})
 const report=await h.cmd('note.write',{clientId:patient.id,episodeId:knee.id,template:'pt.progress',sections:{period:'Episode review',subjective:'Patient reports improved confidence.',objective:brief.body,assessment:'Clinician interpretation: progress remains limited by stair confidence. Reviewed patient-reported scores and logs.',goals:'Discuss stair goal at next visit.',plan:'Continue the existing clinician-selected plan pending reassessment.'}},priya.cookie)
 const filed=await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)
 assert.equal(filed.value.notes.find(n=>n.id===report.id).episodeId,knee.id)
 const amended=await h.cmd('note.amend',{id:report.id,revision:1,sections:{period:'Episode review',subjective:'Patient reports improved confidence.',objective:brief.body,assessment:'Clinician edited: reported adherence is incomplete and needs discussion at the next visit.',goals:'Discuss stair goal at next visit.',plan:'Continue the existing clinician-selected plan pending reassessment.'}},priya.cookie)
 assert.equal(amended.revision,2)
 const chart=await h.send(filePath,undefined,priya.cookie)
 assert.equal(chart.status,200,chart.text);assert.match(chart.text,/Clinician edited/)
 await onStage({stage:'edited-report',h,patient,priya,patientCookie,filePath,knee,back,brief,note:report})
 // Stop immediately invalidates pending preparation and the patient's unanswered tasks.
 await h.cmd('outcome.stop',{id:schedule.id},priya.cookie)
 await h.cmd('outcome.prepare',{id:schedule.id},priya.cookie,409)
 await h.cmd('outcome.approve',approval,priya.cookie,409)
 return {patient,priya,patientCookie,filePath,knee,back,brief,note:report}
}
