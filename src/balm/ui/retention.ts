import { check, field, form, h, hidden, panel, result, select, stamp, textarea, usDate } from './shared'
import { destructionGroups } from '../retention/labels'

const inventoryList = (records:Record<string,number>) => `<ul>${destructionGroups(records).map(x=>`<li>${h(x.label)}: ${h(x.count)}</li>`).join('')}</ul>`
const years = (value: unknown) => value === null ? 'Unresolved' : `${h(value)} years`
const reasons: Record<string,string> = { state_rule_requires_review:'The applicable state rule is unresolved.', date_of_birth_required:'Add the patient’s date of birth.', last_treatment_unknown:'No treatment date is available.', legal_hold:'A legal hold blocks destruction.', retention_period_not_complete:'The retention period has not ended.' }
export function retentionPanel(s: any, path = '/app/clinic') {
  const r = s.retention
  if (!r) return ''
  const p = r.policy
  const settings = form('retention.save',path,(p ? hidden('version',p.version) : '')
    + select('state','Practice state',[['','Choose a state'],...r.states.map((x:any)=>[x.state,x.name])],p?.state??'')
    + field('adultYears','Practice adult retention (years)',p?.adult_years??'','number','min="0" max="100" placeholder="State rule"')
    + field('minorYears','Practice retention after majority (years)',p?.minor_years??'','number','min="0" max="100" placeholder="State rule"')
    + field('payerYears','Longest payer requirement (years)',p?.payer_years??0,'number','min="0" max="100" placeholder="State rule"')
    + field('majorityAge','Applicable age of majority',p?.majority_age??'','number','min="18" max="21" placeholder="State rule"')
    + textarea('reviewedRule','Owner’s applicable longer rule and source',p?.reviewed_rule??'','maxlength="2000"')
    + '<p class="help">For an ambiguous rule, record the applicable authority and a longer adult and minor period. Include payer, licensing and other applicable obligations; there is no universal seven-year HIPAA retention period.</p>','Save retention policy')
  const applied = p ? `<p>Applied adult period: ${years(p.adult)} after last treatment. Minor records: the later of that date and age ${h(p.majority)} plus ${years(p.minor)}. Later clinical entries extend the period. ${p.resolved?'':'Destruction is blocked until the applicable state rule is resolved.'}</p>` : ''
  const table = `<details><summary>State sources and coverage · reviewed ${usDate(r.reviewedOn,'UTC')}</summary><div class="table"><table class="retention-sources"><thead><tr><th>State</th><th>Adult</th><th>After majority</th><th>Applicable rule and source</th></tr></thead><tbody>${r.states.map((x:any)=>`<tr><td>${h(x.name)}</td><td>${years(x.adultYears)}</td><td>${years(x.minorYears)}</td><td><strong>${h(x.status)}</strong> · ${h(x.explanation)} <a href="${h(x.source)}" target="_blank" rel="noopener noreferrer">${h(x.sourceTitle)}</a> · retrieved ${usDate(x.reviewedOn,'UTC')}</td></tr>`).join('')}</tbody></table></div></details>`
  const receipts = r.destructions.length ? `<details><summary>Destruction receipts (${r.destructions.length})</summary><ul>${r.destructions.map((d:any)=>`<li>${h(d.id)} · ${stamp(s,d.destroyed_at)} · approved by ${h(d.approved_by)}<details><summary>Approved inventory and policy</summary>${inventoryList(JSON.parse(d.inventory).records)}<p>Audit details scrubbed; clinical content and private links destroyed.</p><p>State: ${h(JSON.parse(d.policy).state)}; applied adult period: ${years(JSON.parse(d.policy).adultYears)}; after majority: ${years(JSON.parse(d.policy).minorYears)}.</p></details></li>`).join('')}</ul></details>` : '<p>No records have been destroyed.</p>'
  return panel('Record retention',applied+settings+table+receipts,'full','retention')
}
export function clientRetentionPanel(s:any,f:any,path=`/app/clients/${f.client.id}`) {
  const r=f.retention
  if(!r) return ''
  const hold=r.holds[0]
  const body=`<p>${r.lastTreatment?`Last treatment: ${usDate(r.lastTreatment,'UTC')}. `:''}${r.eligibleAfter?`Retain through ${usDate(r.eligibleAfter,'UTC')}. `:''}${r.eligible?'Eligible for owner review.':r.reasons.map((x:string)=>h(reasons[x]??x)).join(' ')}</p>`
    +(hold?`<p><strong>Legal hold:</strong> ${h(hold.reason)} · ${stamp(s,hold.set_at)}</p>`:'')
    +form('retention.hold',path,hidden('clientId',f.client.id)+(hold?hidden('release','on'):'')+textarea('reason',hold?'Reason for releasing this hold':'Legal hold reason','','required maxlength="1000"'),hold?'Release legal hold':'Place legal hold',true)
    +(r.eligible?form('retention.preview',path,hidden('clientId',f.client.id),'Review destruction list',true):'')
  return panel('Record retention and legal hold',body)
}
export function retentionPreview(s:any,notice:any) {
  const r=notice?result(notice):null
  if(!r?.previewId || !r?.digest) return ''
  return panel('Review permanent destruction',`<p><strong>${h(r.client.firstName)} ${h(r.client.lastName)}</strong> · retained through ${usDate(r.eligibleAfter,'UTC')}. This approval expires ${stamp(s,r.expiresAt)}. Any record or policy change requires a fresh review.</p>${inventoryList(r.records)}<p>Also withdraw ${h(r.withdrawnSharedImports)} shared import originals and ${h(r.withdrawnClaimBatches)} shared claim exports. Other patients’ native records remain available.</p><p>Clinical records, identifiers and private links are permanently removed. Anonymous dated accounting facts, the audit sequence/action/time/actor and opaque references, and this destruction receipt remain. Patient free text in audit details is scrubbed. Predestruction archives are refused when the destination knows this later erasure or receives the later erasure journal. A fresh destination without that journal has unverified erasure history.</p>`
    +form('retention.destroy','/app/clinic',hidden('previewId',r.previewId)+hidden('digest',r.digest)+check('confirm','I reviewed this exact list and approve permanent destruction.'),'Permanently destroy reviewed records'),'full','retention-review')
}
