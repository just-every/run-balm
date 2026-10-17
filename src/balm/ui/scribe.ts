// The Clinic page's scribe card: the owner completes it from this page alone by
// choosing a provider and pasting the clinic's own API key; the key is sealed and
// never shown again. Managed hosting and a missing key each say so in one line.
import { field, form, h, panel, result, select, status } from './shared'
import { icons } from './icons'

function checkResult(notice: any) {
  const r = result(notice)
  if (!r || typeof r.ok !== 'boolean' || typeof r.message !== 'string') return ''
  return `<div class="notice${r.ok ? '' : ' error'}" role="status"><strong>${r.ok ? 'Scribe working.' : 'Scribe not working.'}</strong> ${h(r.message)}</div>`
}

export function scribeCard(s: any, notice: any) {
  const sc = s.scribe
  if (!sc) return ''
  if (sc.managed) return panel('Scribe (AI drafting)', `<p>${status('Not available yet')} ${h(sc.line)}</p>`, '', icons.sparkle)
  const saved = sc.saved
  const state = sc.ready
    ? `<p>${status('Ready')} ${h(saved?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible')} · ${h(saved?.model)} · key ${h(saved?.key_hint)}<br><span class="help">Saved by ${h(saved?.updated_by)} · ${h(saved?.updated_at?.slice(0, 10))}</span></p>`
    : `<p>${status('No key')} ${h(sc.line)}</p>`
  const steps = '<ol class="steps"><li>Create an API key with your provider: for Anthropic, open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com → API keys</a> and choose <strong>Create key</strong>. Any OpenAI-compatible Chat Completions provider with JSON-schema answers also works.</li><li>Choose the provider below, paste the key and select <strong>Save scribe settings</strong>. Leave the endpoint and model blank for Anthropic’s defaults.</li><li>Select <strong>Test the scribe</strong>: it sends one made-up dictation, never a patient’s.</li></ol>'
    + '<p class="help">Practitioners’ dictation goes to this provider when they ask for a draft. Use a provider that has signed a HIPAA business associate agreement with your practice before entering real patient details. The key is stored encrypted and never shown again.</p>'
  const settings = form('scribe.save', '/app/clinic', select('provider', 'Provider', [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI-compatible']], saved?.provider ?? 'anthropic')
    + field('key', saved ? 'API key (leave blank to keep the saved key)' : 'API key', '', 'password', `${saved ? '' : 'required '}maxlength="400" autocomplete="off"`)
    + `<div class="pair">${field('model', 'Model (blank for the default)', saved?.model ?? '', 'text', `maxlength="120" placeholder="${h(sc.defaults.anthropic.model)}"`)}${field('endpoint', 'Endpoint (blank for the default)', saved?.endpoint ?? '', 'url', `maxlength="300" placeholder="${h(sc.defaults.anthropic.endpoint)}"`)}</div>`
    + field('workspace', 'Anthropic workspace ID (only if your key is not scoped to one workspace)', saved?.workspace ?? '', 'text', 'maxlength="120" placeholder="wrkspc_…"'), 'Save scribe settings')
  const test = sc.ready ? form('scribe.check', '/app/clinic', '', 'Test the scribe', true) + form('scribe.remove', '/app/clinic', '', 'Remove the key', true) : ''
  return `<section class="panel full" id="scribe"><h2><span class="disc">${icons.sparkle}</span>Scribe (AI drafting)</h2>${checkResult(notice)}${state}<p>The scribe drafts a treatment note in the visit’s template from the practitioner’s dictation or bullet points, using this clinic’s own AI model. The practitioner reviews and signs; the scribe never signs.</p>${sc.ready ? '' : steps}${settings}${sc.ready ? `<details><summary>How it works</summary>${steps}</details>` : ''}<div class="actions">${test}</div></section>`
}
