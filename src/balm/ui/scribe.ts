// The Clinic page's scribe card: the owner completes it from this page alone by
// choosing a provider and pasting the clinic's own API key; the key is sealed and
// never shown again. Saving runs the test, and the scribe is Ready only once a
// test passes. Managed hosting and a missing key each say so in one line.
import { field, form, h, panel, result, select, stamp, status } from './shared'

function checkResult(notice: any) {
  const r = result(notice)
  if (!r || typeof r.ok !== 'boolean' || typeof r.message !== 'string') return ''
  return `<div class="notice${r.ok ? '' : ' error'}" role="status"><strong>${r.ok ? 'Scribe working.' : 'Scribe not working.'}</strong> ${h(r.message)}</div>`
}

const steps = '<ol class="steps">'
  + '<li><strong>Create an API key.</strong> For Anthropic (Claude), open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com → Settings → API keys</a>, select <strong>Create key</strong>, choose the workspace the key belongs to, name it “Balm scribe”, and copy the key (it starts with <code>sk-ant-</code>).</li>'
  + '<li><strong>Find the workspace ID, only if Balm asks for it.</strong> A key made inside a workspace needs nothing more. If the test says Anthropic needs a workspace, open <a href="https://platform.claude.com/settings/workspaces" target="_blank" rel="noreferrer">platform.claude.com → Settings → Workspaces</a>, open the workspace, and copy its ID: it starts with <code>wrkspc_</code> and is also the last part of that page’s web address.</li>'
  + '<li><strong>Paste the key below and select Save and test.</strong> Leave the model and web address blank for Anthropic. Balm then sends one made-up dictation (never a patient’s) and shows <strong>Ready</strong> only when the draft comes back right.</li>'
  + '</ol>'
  + '<p class="help"><strong>Not using Anthropic?</strong> Choose <strong>Other (OpenAI-style)</strong> for OpenAI or any provider that accepts the same requests, and enter the model name and the web address of its chat API that the provider gives you (for OpenAI, leave the address blank and enter a model such as <code>gpt-5</code>).</p>'
  + '<p class="help">Practitioners’ dictation goes to this provider when they ask for a draft. Use a provider that has signed a HIPAA business associate agreement with your practice before entering real patient details. The key is stored encrypted and never shown again.</p>'

function state(s: any, sc: any) {
  const saved = sc.saved
  if (!saved) return `<p>${status('No key')} ${h(sc.line)}</p>`
  const what = `${h(saved.provider === 'anthropic' ? 'Anthropic' : 'Other (OpenAI-style)')} · ${h(saved.model)} · key ${h(saved.key_hint)}`
  const tested = saved.checked_at ? `Last tested ${stamp(s, saved.checked_at)}` : 'Not tested yet'
  const badge = sc.ready ? status('Ready') : saved.checked_at ? status('Not working') : status('Not tested')
  const why = saved.check_message ? `<br><strong>Last test:</strong> ${h(saved.check_message)}` : ''
  return `<p>${badge} ${what}<br><span class="help">Saved by ${h(saved.updated_by)} · ${stamp(s, saved.updated_at)} · ${tested}</span>${why}</p>`
}

export function scribeCard(s: any, notice: any) {
  const sc = s.scribe
  if (!sc) return ''
  if (sc.managed) return panel('Scribe (AI drafting)', `<p>${status('Not available yet')} ${h(sc.line)}</p>`)
  const saved = sc.saved
  const settings = form('scribe.save', '/app/clinic', select('provider', 'Provider', [['anthropic', 'Anthropic (Claude)'], ['openai', 'Other (OpenAI-style)']], saved?.provider ?? 'anthropic')
    + field('key', saved ? 'API key (leave blank to keep the saved key)' : 'API key', '', 'password', `${saved ? '' : 'required '}maxlength="400" autocomplete="off" placeholder="sk-ant-…"`)
    + field('workspace', 'Anthropic workspace ID (only if the test asks for it; see step 2)', saved?.workspace ?? '', 'text', 'maxlength="120" placeholder="wrkspc_…"')
    + `<details${saved?.provider === 'openai' ? ' open' : ''}><summary>Model and web address (only for another provider or model)</summary><div class="pair">${field('model', 'Model name (blank for Anthropic’s default)', saved?.model ?? '', 'text', `maxlength="120" placeholder="${h(sc.defaults.anthropic.model)}"`)}${field('endpoint', 'Web address of the chat API (blank for the provider’s own)', saved?.endpoint ?? '', 'url', `maxlength="300" placeholder="${h(sc.defaults.anthropic.endpoint)}"`)}</div></details>`, 'Save and test')
  const test = saved ? form('scribe.check', '/app/clinic', '', 'Test again', true) + form('scribe.remove', '/app/clinic', '', 'Remove the key', true) : ''
  return `<section class="panel full" id="scribe"><h2>Scribe (AI drafting)</h2>${checkResult(notice)}${state(s, sc)}<p>The scribe drafts a treatment note in the visit’s template from the practitioner’s dictation or bullet points, using this clinic’s own AI model. The practitioner reviews and signs; the scribe never signs.</p>${sc.ready ? `<details><summary>How to set it up</summary>${steps}</details>` : steps}${settings}<div class="actions">${test}</div></section>`
}
