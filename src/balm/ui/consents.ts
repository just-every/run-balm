import { policyField, policyKinds, optionalPolicy } from '../intake/policies'
import { field, form, h, hidden, panel, select } from './shared'

export function policyForms(s: any) {
  return panel('Consent and policy documents', '<p>Publish your clinic’s documents here. Each publication is permanent; changes create a new version. Patients review each document and sign the versions they accept. Telehealth and SMS consent can be declined.</p>'
    + policyKinds.map(([kind, label]) => {
      const p = (s.policies ?? []).find((p: any) => p.kind === kind)
      return `<details class="entry"><summary>${h(label)} · ${p ? `version ${p.version}` : 'Not published'}</summary>`
        + form('consent.publish', '/app/intake', hidden('kind', kind) + hidden('version', p?.version ?? 0)
          + field('title', 'Document title', p?.title ?? label, 'text', 'required maxlength="160"')
          + `<label>Full document text<textarea name="body" required maxlength="30000" rows="10">${h(p?.body ?? '')}</textarea></label>`, p ? 'Publish updated policy' : 'Publish policy') + '</details>'
    }).join(''), 'full')
}
export function patientPolicies(policies: any[]) {
  if (!policies.length) return ''
  return '<fieldset><legend>Documents to review and sign</legend><p>Read each document. Your signature below signs each document you accept. SMS and telehealth consent are optional.</p>'
    + policies.map(p => `<article class="entry"><h3>${h(p.title)} · version ${p.version}</h3><div style="white-space:pre-wrap">${h(p.body)}</div>${hidden(policyField(p.kind, 'Version'), p.id)}`
      + (optionalPolicy(p.kind) ? select(policyField(p.kind, 'Accepted'), `${p.title} decision`, [['','Choose your decision'],['on','I accept and sign this document'],['decline','I decline']], '')
        : `<label class="check"><input type="checkbox" name="${policyField(p.kind, 'Accepted')}" value="on" required><span>I have read and intend to sign ${h(p.title)}.</span></label>`) + '</article>').join('') + '</fieldset>'
}
