import assert from 'node:assert/strict'
import {viewportProof} from './viewport-proof.mjs'
import {readFile} from 'node:fs/promises'
import {clinic} from './clinic.mjs'

export function customFields(files) {
  const copy=structuredClone(files),patient=copy.find(f=>f.kind==='patients')
  patient.csv=patient.csv.trim().split(/\r?\n/).map((line,index)=>line+(index===0?',Migration ribbon colour,Archived drawer reference':`,synthetic-balm-${index},drawer-${index}`)).join('\n')
  return copy
}

export function assertMapping(preview) {
  const report=preview.migrationReport
  assert.ok(report.fields.some(f=>f.column==='First Name'&&f.target==='firstName'))
  for(const column of ['Migration ribbon colour','Archived drawer reference']){
    const field=report.fields.find(f=>f.column===column)
    assert.equal(field.target,null)
    assert.deepEqual(field.examples.map(e=>e.row),[2,3])
    assert.ok(field.examples.every(e=>e.value))
  }
}

export async function agentFences(h,input) {
  const key=await h.cmd('agent.create',{label:'Migration proposal',scopes:['migration.prepare']})
  const headers={authorization:'Bearer '+key.token}
  const nonclinical={...input,files:input.files.filter(f=>f.kind!=='notes').map(f=>({...f,csv:f.csv.replaceAll('cli-','agent-cli-')}))}
  const prepared=await h.send('/api/balm/agent/command',{name:'movein.prepare',input:nonclinical},'',headers)
  assert.equal(prepared.status,200,prepared.text)
  assert.equal(prepared.value.result.ownerReviewRequired,true)
  assert.ok(prepared.value.result.migrationReport.fields.some(f=>f.omitted))
  assert.doesNotMatch(prepared.text,/Maya|Santos|patients\.example|drawer-1|synthetic-balm-1|Synthetic historical/)
  assert.equal((await h.send('/api/balm/agent/command',{name:'movein.prepare',input},'',headers)).status,403)
  for(const name of ['movein.cutover','movein.apply','movein.undo'])assert.equal((await h.send('/api/balm/agent/command',{name,input:nonclinical},'',headers)).status,403)
  const other=await h.cmd('agent.create',{label:'Unrelated invoice key',scopes:['invoice.prepare']})
  assert.equal((await h.send('/api/balm/agent/command',{name:'movein.prepare',input:nonclinical},'',{authorization:'Bearer '+other.token})).status,403)
  const ownerReview=await h.cmd('movein.preview',nonclinical)
  assertMapping(ownerReview)
  assert.equal(ownerReview.mappingPrepared,true)
  assert.equal(ownerReview.mappingDigest,prepared.value.result.mappingDigest)
  await h.cmd('movein.cutover',{...nonclinical,fingerprint:ownerReview.fingerprint,acceptanceReason:'Not yet approved.'},h.owner,409)
  const inherited={...nonclinical,mappingApproval:ownerReview.mappingDigest,cutoverApproval:ownerReview.fingerprint}
  const unchecked=await h.form('/app/action?name=movein.cutover&returnTo=%2Fapp%2Fimport',{bundleBase64:Buffer.from(JSON.stringify(inherited)).toString('base64'),fingerprint:ownerReview.fingerprint,acceptanceReason:'Approval must be checked in this submission.'},h.owner)
  assert.equal(unchecked.status,409)
  assert.equal((await h.state()).clients.length,0)
  const applied=await h.cmd('movein.cutover',{...nonclinical,fingerprint:ownerReview.fingerprint,mappingApproval:ownerReview.mappingDigest,cutoverApproval:ownerReview.fingerprint,acceptanceReason:'Owner reviewed the agent proposal and omitted custom fields against the source exports.'})
  const approval=await h.db.prepare('SELECT prepared_role,approved_by FROM bm_approvals WHERE subject_id=?').bind(applied.job.id+':mapping').first()
  assert.equal(approval.prepared_role,'agent')
  assert.equal(approval.approved_by,h.auth.OWNER_EMAIL)
  await h.cmd('movein.undo',{jobId:applied.job.id})
  assert.equal((await h.state()).clients.length,0)
  await h.cmd('agent.revoke',{id:key.id})
  assert.equal((await h.send('/api/balm/agent/command',{name:'movein.prepare',input:nonclinical},'',headers)).status,401)
}

export async function migrationBrowser(h,input) {
  await viewportProof(h,[{name:'AGENT-008-mapping',path:'/app/import',cookie:h.owner,selector:'.movein-preview',interact:async({page})=>{
    await page.goto(h.origin+'/app/import')
    await page.locator('select[name=provider]').selectOption(input.provider)
    const patient=input.files.find(f=>f.kind==='patients')
    await page.locator('input[name=patients]').setInputFiles({name:patient.name,mimeType:'text/csv',buffer:Buffer.from(patient.csv)})
    await page.getByRole('button',{name:'Preview move-in',exact:true}).click()
    await page.getByRole('heading',{name:'Proposed field mapping',exact:true}).waitFor()
    await page.locator('input[name=mappingApproval]').waitFor()
    await page.locator('input[name=cutoverApproval]').waitFor()
    assert.equal(await page.locator('input[name=mappingApproval]').isChecked(),false)
    assert.equal(await page.locator('input[name=cutoverApproval]').isChecked(),false)
  }}])
}

/** Standalone real-Worker browser driver; the callback can submit the owner forms. */
export async function migrationAgentJourney(h,callback) {
  await h.finishSetup()
  const {service,practitioners:[therapist]}=await clinic(h)
  const files=customFields(await Promise.all(['patients','appointments','notes','balances','insurance'].map(async kind=>({kind,name:kind+'.csv',csv:(await readFile('tests/fixtures/movein/cliniko/'+kind+'.csv','utf8')).replaceAll('{{MONTH1}}','2020-02').replaceAll('{{MONTH2}}','2020-03')}))))
  const input={provider:'cliniko',files,practitionerId:therapist.id,serviceId:service.id,dateFormat:'MDY'}
  const preview=await h.cmd('movein.prepare',input)
  assertMapping(preview)
  if(callback)await callback({input,preview})
  const applied=await h.cmd('movein.cutover',{...input,fingerprint:preview.fingerprint,mappingApproval:preview.mappingDigest,cutoverApproval:preview.fingerprint,acceptanceReason:'Reviewed custom omissions, opening balances and original records.'})
  if(callback)await callback({input,preview,applied})
  return {input,preview,applied}
}
