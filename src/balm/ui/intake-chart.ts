import { empty, field, form, h, hidden, panel, select, stamp } from './shared'

/** Data from intakeChart; reception receives insurance only, never signed clinical PDFs. */
export function intakeChartPanel(s: any, data: any) {
  if (!data) return ''
  const returnTo = '/app/clients/' + s.file?.client?.id
  const consents = data.consents === null ? '' : panel('Signed intake documents', data.consents.map((c: any) => `<article class="entry"><h3>${h(c.policy_title)}</h3><p>Signed by ${h(c.signer_name)} (${h(c.signer_relationship)}) · ${stamp(s, c.signed_at)}</p><p>Policy version ${h(c.policy_number ?? c.policy_version)}</p><a href="/app/intake/consents/${h(c.id)}.pdf">Download fixed signed PDF</a></article>`).join('') || empty('No signed intake documents received yet.'))
  return consents + (data.pendingPolicies?.length ? panel('Documents awaiting signature', '<ul>' + data.pendingPolicies.map((p: any) => `<li>${h(p.title)} · version ${p.version}</li>`).join('') + '</ul>' + form('consent.request', returnTo, hidden('clientId', s.file?.client?.id), 'Email documents to review')) : '') + panel('Insurance cards and verification', `<p>${h(data.ai?.message ?? 'Staff check insurance fields against the original card before marking them verified.')}</p>` + (data.insurance.map((i: any) => {
    const draft = i.ai_draft
    const summary = draft ? `<details><summary>AI suggestions — check against the card</summary><dl>${Object.entries(draft).map(([key,value])=>`<dt>${h(key)}</dt><dd>${h(value || 'Not read')}</dd>`).join('')}</dl><p>These suggestions have not replaced the patient’s fields.</p></details>` : ''
    const photos = ['front','back'].filter(side => i['has_' + side]).map(side => `<a href="/app/intake/insurance/${h(i.id)}/${side}">View card ${side}</a>`).join(' · ')
    return `<article class="entry"><h3>${h(i.payer)}</h3><p>${i.verified_at ? `Checked by ${h(i.verified_by)} · ${stamp(s,i.verified_at)}` : 'Awaiting staff verification'}</p><p>${photos || 'No card photos uploaded.'}</p>${summary}`
      + (data.ai?.available && (i.has_front || i.has_back) ? form('insurance.read', returnTo, hidden('id',i.id), 'Read card with AI', true) : '')
      + form('insurance.verify', returnTo, hidden('id',i.id) + hidden('version',i.version)
        + field('payer','Payer',i.payer,'text','required maxlength="150"') + field('memberId','Member ID',i.member_id,'text','required maxlength="100"')
        + field('group','Group number',i.group_number,'text','maxlength="100"') + field('subscriber','Subscriber',i.subscriber_name,'text','required maxlength="150"')
        + select('relationship','Patient’s relationship to subscriber',[['self','Self'],['spouse','Spouse'],['child','Child'],['other','Other']],i.relationship)
        + '<label class="check"><input name="confirm" type="checkbox" value="on" required><span>I checked these fields against the card.</span></label>', 'Save verified insurance') + '</article>'
  }).join('') || empty('No insurance details submitted.')))
}
