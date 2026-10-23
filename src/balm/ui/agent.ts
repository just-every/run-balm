import {integrationPanel,scopeChoices} from './portal-integrations'
// Agent access: the owner connects an AI assistant from this page alone. It says
// what a key lets an assistant do, gives the key once with a copy button, walks
// through ChatGPT and command-line assistants step by step, and lists what the
// clinic never shares.
import { copyBox, empty, entry, field, form, h, hidden, panel, result, rows, select, stamp, status } from './shared'


const can = '<ul class="plain"><li><strong>Can read:</strong> the schedule, clients’ names, email addresses and phone numbers, services, practitioners’ hours, invoices and drafts waiting for approval. Each read is recorded in the access audit of every client it names.</li>'
  + '<li><strong>Can prepare, for a person to approve:</strong> invoices for attended visits (on Invoices and reminders), reminder texts for upcoming visits (on Invoices and reminders) and new intake form versions (on Intake form).</li>'
  + '<li><strong>Cannot:</strong> read treatment notes or intake answers, approve or send anything, change appointments, take payments, or see sign-in links and other keys.</li></ul>'

const instructions = (origin: string) => `You help the front desk of a therapy clinic that uses Balm at ${origin}.
Read the clinic with readClinic before you suggest anything. You can only prepare work: invoice.prepare for a visit marked attended, reminder.prepare for an upcoming booked visit, and intake.prepare for a new intake form. Tell me what you prepared; a person at the clinic approves it in Balm.
Never ask me for passwords, sign-in links or treatment notes, and do not repeat clients' details outside this conversation.`

const terminalPrompt = (origin: string) => `Balm, our clinic system, is at ${origin}. Its agent key is in the environment variable BALM_AGENT_KEY; never print it.
Read the clinic: curl -s -H "Authorization: Bearer $BALM_AGENT_KEY" ${origin}/api/balm/agent/context
Prepare work for a person to approve: curl -s -X POST -H "Authorization: Bearer $BALM_AGENT_KEY" -H "content-type: application/json" -d '{"name":"reminder.prepare","input":{"appointmentId":"..."}}' ${origin}/api/balm/agent/command
The names you may use are invoice.prepare (appointmentId, optional amountCents), reminder.prepare (appointmentId) and intake.prepare (title, questions). Field details: https://github.com/just-every/run-balm/blob/main/docs/AGENT-COMMANDS.md`

function connect(s: any, token: string) {
  const origin = String(s.origin ?? ''), local = !!s.local, key = token || 'paste-your-agent-key-here'
  const chatgpt = `<h3>ChatGPT (a custom GPT)</h3>${local ? '<p class="help">ChatGPT reaches Balm over the internet, so this works once Balm is deployed (see Deploy in the docs). On this computer, use a command-line assistant instead.</p>' : ''}<ol class="steps">`
    + '<li>In ChatGPT (a paid plan), open <strong>GPTs → Create</strong>, then the <strong>Configure</strong> tab. Name it, for example “Clinic desk”.</li>'
    + `<li>Paste these into <strong>Instructions</strong>:${copyBox('gpt-instructions', 'Instructions', instructions(origin), 5)}</li>`
    + `<li>Under <strong>Actions</strong>, select <strong>Create new action</strong>, then <strong>Import from URL</strong>, and paste:${copyBox('gpt-schema', 'Schema address', `${origin}/api/balm/agent/openapi.json`)}</li>`
    + '<li>Select <strong>Authentication → API Key</strong>, choose <strong>Bearer</strong>, paste the agent key from step 2, and save.</li>'
    + '<li>In <strong>Additional settings</strong>, turn off “Use conversation data in your GPT to improve our models”. Set the GPT to <strong>Only me</strong>, then select <strong>Create</strong>. Try: “What visits are booked tomorrow? Prepare their reminders.”</li></ol>'
  const terminal = `<h3>Claude Code, Codex or another assistant that runs commands on your computer</h3><ol class="steps">`
    + `<li>In the terminal where you start the assistant, store the key (it stays on this computer):${copyBox('terminal-key', 'Terminal', `export BALM_AGENT_KEY='${key}'`)}</li>`
    + `<li>Start the assistant in that terminal and paste this as your first message:${copyBox('terminal-prompt', 'First message', terminalPrompt(origin), 10)}</li></ol>`
  return chatgpt + terminal
}

const never = '<ul class="plain"><li>Never paste the agent key into a chat message, email, document or shared assistant: put it only where the steps above say.</li>'
  + '<li>Use an assistant your practice has a HIPAA business associate agreement with: client names and visit times are health information.</li>'
  + '<li>Never share sign-in links, the <code>RER_OPEN</code> link, the setup token, or your Cloudflare, mail, Stripe or AI provider keys with an assistant.</li>'
  + '<li>Give each assistant its own key, and select <strong>Revoke agent access</strong> at once if a key may have been seen by anyone else.</li></ul>'

export function agent(s: any, notice: any) {
  const created = result(notice)
  const token = created?.token ? String(created.token) : ''
  const keys = rows(s, 'agentKeys').map(k => entry(k.label, `<p>Permissions: ${h(k.scopes ? JSON.parse(k.scopes).join(', ') : 'Original assistant workspace')}</p>${status(k.revokedAt ? 'Revoked' : Number(k.expiresAt) <= Date.now() ? 'Expired' : 'Active')}<p>Created ${stamp(s, k.createdAt)}<br>Expires ${stamp(s, k.expiresAt)}</p>${!k.revokedAt ? form('agent.revoke', '/app/agent', hidden('id', k.id), 'Revoke agent access', true) : ''}`)).join('')
  const step1 = panel('1. Create a key', form('agent.create', '/app/agent', field('label', 'Which assistant is this for?', '', 'text', 'required maxlength="80" placeholder="ChatGPT on the front desk computer"')+select('scopes','Key permissions',scopeChoices,'appointments.read'), 'Create agent key')
    + '<p class="help">A key works for 30 days. Create a new one when it expires.</p>')
  const step2 = panel('2. Copy the key', token
    ? `<div class="notice" role="status"><strong>Copy this key now.</strong> It is shown only once; Balm keeps only a fingerprint of it.</div>${copyBox('agent-key', 'Agent key', token)}<p>Expires ${stamp(s, created.expiresAt)}.</p>`
    : '<p>Your new key appears here once, right after you create it.</p>')
  return `<h1>Agent access</h1><p>Connect an AI assistant, such as ChatGPT or Claude, so it can look up the schedule and prepare routine work. Everything it prepares waits for a person at the clinic to approve it, and every approval is recorded.</p>`
    + `${panel('What an assistant can do with a key', can, 'full')}<div class="grid">${step1}${step2}</div>`
    + panel('3. Connect your assistant', connect(s, token), 'full')
    + `<div class="grid">${panel('What the clinic never shares', never)}${panel('Agent keys', keys || empty('No agent keys yet.'))}</div>`
    + integrationPanel(s,created)
    + '<p class="help">For developers: <a href="https://github.com/just-every/run-balm/blob/main/docs/AGENT-COMMANDS.md">the agent commands and their fields</a>.</p>'
}

/** Copy buttons: the field is selected too, so copying by hand works where the clipboard is blocked. */
export const copyScript = "document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;const f=document.getElementById(b.dataset.copy);if(!f)return;f.select();(navigator.clipboard?navigator.clipboard.writeText(f.value):Promise.reject()).then(()=>{b.textContent='Copied'},()=>{b.textContent='Selected: press Ctrl+C or ⌘C'})})"
