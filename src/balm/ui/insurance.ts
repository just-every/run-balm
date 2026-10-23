import {insuranceCob} from './insurance-cob'
import {claimWorkPanel} from './claim-work'
import {manualPayerPanel} from './manual-payers'
import { check, empty, entry, form, h, hidden, money, owner, panel, select, stamp, status, usDate, zoneOf } from './shared'
import { insuranceSettings } from './insurance-settings'
import { claimErrors, claimNumber, insurancePath as path, insuranceResult, payerFileUploads, reasonHtml, x12Link } from './insurance-shared'

/** What insurance billing needs, what works today, and what waits on a clearinghouse, in plain words. */
function overview(i: any) {
  const sending = i.adapter?.available
  return `<section class="banner"><img class="banner-art" src="/insurance/mountains.png" alt=""><h2>What billing insurance takes</h2>`
    + '<p>Balm turns signed visits into insurance claims and posts what payers pay or deny. It needs:</p><ol>'
    + '<li><strong>Your practice’s billing details</strong>: billing NPI, federal tax ID (EIN), billing address and a contact.</li>'
    + '<li><strong>The payers you bill</strong>: each insurance company’s payer ID, how it counts timed units, and what you charge it per CPT code.</li>'
    + '<li><strong>Each practitioner’s enrollment</strong> with those payers, with their taxonomy code.</li>'
    + '<li><strong>A clearinghouse account</strong> (Claim.MD, Availity or similar), only to send claims and eligibility checks electronically. A clearinghouse passes files between you and insurance companies; it needs a signed business associate agreement and enrolls you with each payer.</li></ol>'
    + `<div class="split"><div><h3>Works now${sending ? '' : ', without a clearinghouse'}</h3><ul><li><strong>Eligibility by hand</strong>: call the payer or check its website, then record what it said in the patient’s file under Coverage.</li><li><strong>Claims as files</strong>: Balm checks each claim and builds a standard 837P claim file to download and upload to your clearinghouse or the payer’s portal.</li><li><strong>Payer files</strong>: upload the payer’s 835 (payments and denials), 277CA (claim received or rejected) or 271 (eligibility answer) and Balm posts it.</li></ul></div>`
    + `<div><h3>${sending ? 'Electronic sending' : 'Waits on a clearinghouse'}</h3>${sending ? '<p>Your clearinghouse connection is set up: Balm can send claim files and eligibility checks itself, and you still upload the payer’s answers.</p>' : `<ul><li>Balm sending claims and eligibility checks for you.</li><li>Payer answers arriving without an upload.</li></ul><p class="help">${h(i.adapter?.reason ?? '')}</p>`}</div></div>`
    + '<p><a href="https://run-balm.com/docs/insurance">Insurance setup guide, step by step</a></p></section>'
}

export function insurancePage(s: any, notice: any) {
  const day = (date: string) => h(usDate(date, zoneOf(s)))
  const i = s.insurance, queue = i.queue ?? [], batches = i.batches ?? [], payers = i.payers ?? [], denials = queue.filter((q: any) => ['denied', 'rejected', 'partial'].includes(q.status))
  const counts = [['Claims', queue.length], ['Ready for a claim file', queue.filter((q: any) => q.status === 'ready').length], ['Need a fix', denials.length + queue.filter((q: any) => q.status === 'draft').length], ['Paid', queue.filter((q: any) => q.status === 'paid').length]]
  const stats = `<div class="stats">${counts.map(([label, value]) => `<div class="stat"><span class="label">${h(label)}</span><strong class="value">${h(value)}</strong></div>`).join('')}</div>`
  const name = (q: any) => q.snapshot ? `${q.snapshot.patient.first} ${q.snapshot.patient.last}` : 'Patient file'
  const claims = queue.map((q: any) => `<article class="claim-row"><h3><a href="/app/clients/${h(q.client_id)}#claim-${h(q.id)}">${h(name(q))}</a> · ${h(q.snapshot?.payer?.name ?? '')}</h3><p>${status(q.status === 'draft' ? 'held: needs a fix' : q.status)} Billed ${money(q.amount_cents)}${q.payer_paid_cents !== null ? ` · Payer paid ${money(q.payer_paid_cents)}` : ''} · ${day(q.service_date)}${q.snapshot?.kx?.targetedReview ? ' · Targeted medical review threshold exceeded' : ''}</p><p class="claim-id">Claim ${claimNumber(q.id)}</p>${claimErrors(q)}</article>`).join('')
  const ready = queue.filter((q: any) => q.status === 'ready')
  const batchForm = ready.length ? `<details><summary>Build a claim file</summary><p>Choose ready claims for one payer. Balm checks each claim again, then builds one 837P file to download${i.adapter?.available ? ' or send' : ''}.</p>${form('insurance.batch.prepare', path, ready.map((q: any) => check('claim_' + q.id, `${name(q)} · ${q.snapshot?.payer?.name ?? ''} · ${usDate(q.service_date, zoneOf(s))} · ${money(q.amount_cents)}`, '')).join(''), 'Check claims and build 837P file')}</details>` : '<p class="help">Prepare claims from signed visits in each patient’s file.</p>'
  const batchList = batches.map((b: any) => entry(`${payers.find((p: any) => p.id === b.payer_id)?.name ?? 'Claim file'} · ${b.status === 'prepared' ? 'ready to download' : b.status === 'exported' ? 'downloaded, not sent by Balm' : b.status}`, `<p>${stamp(s, b.created_at)}${b.reference ? `<br>Clearinghouse reference: ${h(b.reference)}` : ''}</p><p><a href="${x12Link('837P', b.id)}">Download 837P claim file</a></p>${b.status === 'exported' && !i.adapter?.available ? '<p class="help">Upload this file to your clearinghouse or the payer’s portal. The payer’s 277CA and 835 come back there: upload them on this page.</p>' : ''}${b.can_submit && ['prepared', 'exported'].includes(b.status) && i.adapter?.available ? form('insurance.batch.submit', path, hidden('id', b.id), 'Send through the clearinghouse') : b.status === 'uncertain' ? '<p>Balm cannot tell whether the clearinghouse received this file. Check with the clearinghouse before sending it again.</p>' : ''}`)).join('')
  const fixes = denials.map((q: any) => `<article class="claim-row"><h3><a href="/app/clients/${h(q.client_id)}#claim-${h(q.id)}">${h(name(q))}</a></h3><p>${status(q.status)} · ${day(q.service_date)} · Claim ${claimNumber(q.id)}</p><div class="fix">${(q.errors ?? []).map((e: any) => `<p>${reasonHtml(e)}</p>`).join('')}${q.nextStep ? `<p>${h(q.nextStep)}</p>` : ''}<p><a href="/app/clients/${h(q.client_id)}#claim-${h(q.id)}">Open the claim to correct or draft an appeal</a></p></div></article>`).join('')
  return `<div class="insurance"><h1>Claims &amp; reimbursement</h1><p>Follow each signed visit through the payer’s answer to the patient’s balance.</p>${insuranceResult(notice)}${overview(i)}${stats}${manualPayerPanel(s)}${claimWorkPanel(i.work)}${insuranceCob(s)}<div class="layout"><div>${panel('Claims', (claims || empty('No insurance claims yet. Open a patient file to add a policy and prepare a signed visit’s claim.')) + batchForm)}<div id="batches">${panel('Claim files', batchList || empty('No claim files yet.'))}</div>${insuranceSettings(s)}${claimRequirementsPanel(s)}</div><aside class="sidebar">${panel('Denials with the next step', fixes || empty('No denials or rejections waiting.'))}${payerFileUploads(payers, path)}</aside></div></div>`
}

function claimRequirementsPanel(s:any){
 if(!owner(s))return ''
 const i=s.insurance,payers=i.payers??[]
 if(!payers.length)return ''
 return panel('Payer claim requirements',`<details id="claim-requirements"><summary>Authorization, certification and filing requirements</summary><p>Record the requirements from each payer’s contract or provider manual. Balm holds claims that do not meet a recorded requirement. Filing instructions and their service-date ranges are recorded in the claim work queue.</p>${payers.map((p:any)=>{
 const r=(i.requirements??[]).find((r:any)=>r.payer_id===p.id)
 return form('insurance.requirements.save',path,hidden('payerId',p.id)+`<h3>${h(p.name)}</h3>`+check('authorization','Authorization required',r?.authorization?'checked':'')+check('certification','Physician-certified plan required',r?.certification?'checked':'')+check('filing','Dated filing instruction required',r?.filing?'checked':'')+`<label>Payer instruction source<textarea name="source" required>${h(r?.source??'')}</textarea></label>`,'Save claim requirements')
 }).join('')}</details>`)
}
