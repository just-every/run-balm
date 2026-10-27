import assert from 'node:assert/strict'
import { clinic, pastVisit } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'
import { viewportProof } from './viewport-proof.mjs'

export async function letterFixture(h) {
 await h.finishSetup()
 const {service,practitioners:[priya,other]}=await clinic(h,['Priya','Other'])
 const patient=await h.cmd('client.save',{firstName:'Letter',lastName:'Patient',email:'letter@patient.example',dateOfBirth:'1980-01-02'})
 const episode=await h.cmd('episode.open',{clientId:patient.id,title:'Right knee progress',start:'direct_access'})
 const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,2,{episodeId:episode.id})
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Knee flexion improved to 110 degrees. Continue graded exercise.'},priya.cookie)
 await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 return {priya,other,patient,episode,note}
}
export async function letterJourney(h) {
 const bytes=async(path,cookie)=>{const r=await h.mf.dispatchFetch(h.origin+path,{headers:{cookie}});assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer())}
 const {priya,other,patient,episode,note}=await letterFixture(h)
 const desk=await h.staff('Letterdesk','reception')
 const biller=await h.staff('Letterbiller','biller')
 await h.cmd('letter.prepare',{noteId:note.id},biller.cookie,403)
 const agent=await h.cmd('agent.create',{label:'Letter access refused'})
 assert.equal((await h.send('/api/balm/agent/command',{name:'letter.prepare',input:{noteId:note.id}},'',{authorization:'Bearer '+agent.token})).status,403)
 await h.cmd('letter.prepare',{noteId:note.id},desk.cookie,403)
 await h.cmd('letter.prepare',{noteId:note.id},other.cookie,404)
 const unsigned=await h.cmd('note.write',{clientId:patient.id,body:'Unreviewed private draft.'},priya.cookie)
 await h.cmd('letter.prepare',{noteId:unsigned.id},priya.cookie,404)
 const pageBefore=await h.send('/app/clients/'+patient.id,undefined,priya.cookie)
 const prepareAction=pageBefore.text.match(/action="([^"]*name=letter.prepare[^"]*)"/)[1].replaceAll('&amp;','&')
 assert.equal((await h.form(prepareAction,{noteId:note.id},priya.cookie)).status,303)
 const getFile=async()=> (await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)).value
 const draft=(await getFile()).letters[0]
 const letter={id:draft.id,sha256:draft.sha256}
 assert.equal(draft.body,'Knee flexion improved to 110 degrees. Continue graded exercise.')
 assert.equal(draft.episode_id,episode.id);assert.equal(draft.author_id,priya.id)
 assert.equal((await h.send('/api/balm/letters/'+letter.id+'.pdf',undefined,other.cookie)).status,404)
 assert.equal((await h.send('/api/balm/letters/'+letter.id+'.pdf',undefined,desk.cookie)).status,403)
 const cookie=await portalLogin(h,'letter@patient.example')
 assert.ok(!(await h.send('/portal/home',undefined,cookie)).text.includes('/portal/letters/'+letter.id))
 await h.cmd('letter.deliver',{...letter,attest:true},other.cookie,404)
 await h.cmd('letter.deliver',letter,priya.cookie,400)
 const changed=await h.cmd('letter.edit',{...letter,body:draft.body+'\nReviewed: walking tolerance is improving.'},priya.cookie)
 await h.cmd('letter.deliver',{...letter,attest:true},priya.cookie,409)
 const reviewed=await h.send('/api/balm/letters/'+letter.id+'.pdf',undefined,priya.cookie)
 assert.equal(reviewed.status,200);assert.match(reviewed.text,/walking tolerance/)
 const reviewedBytes=await bytes('/api/balm/letters/'+letter.id+'.pdf',priya.cookie)
 await viewportProof(h,[{name:'CHART-011-review',path:'/app/clients/'+patient.id,cookie:priya.cookie,selector:'#clinical-letters',open:'Review and edit letter'}])
 const reviewPage=await h.send('/app/clients/'+patient.id,undefined,priya.cookie)
 const deliverAction=reviewPage.text.match(/action="([^"]*name=letter.deliver[^"]*)"/)[1].replaceAll('&amp;','&')
 assert.equal((await h.form(deliverAction,{...changed,attest:'on'},priya.cookie)).status,303)
 const delivered=(await getFile()).letters[0]
 const sent={...changed,documentId:delivered.document_id}
 assert.equal(delivered.channel,'portal');assert.equal(delivered.author_email,priya.email)
 const deliveryAudit=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.audit
 assert.ok(deliveryAudit.some(a=>a.action==='letter.portal_delivered'&&a.subject_id===letter.id))
 const original=await h.send('/api/balm/chart-documents/'+sent.documentId,undefined,priya.cookie)
 assert.equal(original.text,reviewed.text)
 assert.deepEqual(await bytes('/api/balm/chart-documents/'+sent.documentId,priya.cookie),reviewedBytes)
 await h.cmd('letter.edit',{...changed,body:'Replace the original'},priya.cookie,409)
 await h.cmd('letter.deliver',{...changed,attest:true},priya.cookie,409)
 await h.cmd('note.addendum',{id:note.id,body:'Later chart change: flexion is now 120 degrees.'},priya.cookie)
 assert.equal((await h.send('/api/balm/chart-documents/'+sent.documentId,undefined,priya.cookie)).text,original.text)
 assert.deepEqual(await bytes('/api/balm/chart-documents/'+sent.documentId,priya.cookie),reviewedBytes)
 const history=await h.send('/api/balm/clients/'+patient.id+'/history?historyType=progress_letter&historyEpisode='+episode.id+'&historyText=walking',undefined,priya.cookie)
 assert.deepEqual(history.value.entries.map(e=>e.id),[sent.documentId]);assert.equal(history.value.entries[0].episodeId,episode.id)
 const another=await h.cmd('episode.open',{clientId:patient.id,title:'Unrelated shoulder',start:'direct_access'})
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/history?historyType=progress_letter&historyEpisode='+another.id,undefined,priya.cookie)).value.total,0)
 await h.cmd('episode.assign',{kind:'document',recordId:sent.documentId,episodeId:another.id},h.owner,409)
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/history?historyType=progress_letter',undefined,desk.cookie)).status,403)
 assert.equal((await h.send('/api/balm/chart-documents/'+sent.documentId,undefined,other.cookie)).status,404)
 await h.cmd('chart.break_glass',{clientId:patient.id,reason:'short'},other.cookie,400)
 const reason='Urgent covering clinician review of patient progress'
 const glass=await h.cmd('chart.break_glass',{clientId:patient.id,reason},other.cookie)
 assert.equal((await h.send('/api/balm/chart-documents/'+sent.documentId,undefined,other.cookie)).text,original.text)
 const audit=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.audit
 assert.ok(audit.some(a=>a.action==='chart.document_downloaded'&&a.subject_id===sent.documentId&&a.detail.includes(reason)))
 await h.cmd('chart.break_glass.end',{id:glass.id})
 assert.equal((await h.send('/api/balm/chart-documents/'+sent.documentId,undefined,other.cookie)).status,404)
 const download='/portal/letters/'+sent.documentId+'.pdf'
 assert.equal((await h.send(download,undefined,cookie)).text,original.text)
 assert.deepEqual(await bytes(download,cookie),reviewedBytes)
 const foreign=await h.cmd('client.save',{firstName:'Other',lastName:'Patient',email:'foreign-letter@patient.example'})
 const foreignCookie=await portalLogin(h,'foreign-letter@patient.example')
 assert.equal((await h.send(download,undefined,foreignCookie)).status,404)
 assert.ok(!(await h.send('/portal/home',undefined,foreignCookie)).text.includes(sent.documentId))
 assert.equal((await h.send(download,undefined,h.owner)).status,303)
 await viewportProof(h,[{name:'CHART-011-portal',path:'/portal/home',cookie,selector:'#letters'}])
 assert.ok((await h.send('/portal/home',undefined,cookie)).text.includes(download))
 await h.db.prepare('UPDATE bm_portal_sessions SET revoked_at=? WHERE client_id=?').bind(new Date().toISOString(),patient.id).run()
 assert.equal((await h.send(download,undefined,cookie)).status,303)
 const unfiled=await h.cmd('client.save',{firstName:'Legacy',lastName:'Letter'})
 const legacyVisit=await pastVisit(h,unfiled.id,priya,(await h.state()).services[0].id,h.owner,8)
 const legacyNote=await h.cmd('note.write',{clientId:unfiled.id,appointmentId:legacyVisit,body:'Unassigned historical source'},priya.cookie)
 await h.cmd('note.sign',{id:legacyNote.id,revision:1,signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 await h.cmd('episode.open',{clientId:unfiled.id,title:'New unrelated episode',start:'direct_access'})
 const legacyLetter=await h.cmd('letter.prepare',{noteId:legacyNote.id},priya.cookie)
 const legacySent=await h.cmd('letter.deliver',{...legacyLetter,attest:true},priya.cookie)
 const legacyHistory=await h.send('/api/balm/clients/'+unfiled.id+'/history?historyType=progress_letter&historyEpisode=none',undefined,priya.cookie)
 assert.deepEqual(legacyHistory.value.entries.map(e=>e.id),[legacySent.documentId])
 const pending=await h.cmd('letter.prepare',{noteId:note.id},priya.cookie)
 await h.cmd('staff.save',{id:priya.id,name:'Priya',email:priya.email,role:'practitioner',active:false})
 await h.cmd('letter.deliver',{...pending,attest:true},priya.cookie,403)
 assert.equal((await h.send('/api/balm/letters/'+pending.id+'.pdf',undefined,priya.cookie)).status,403)
 return {patient,letter,sent,original:original.text}
}
