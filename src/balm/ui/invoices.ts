import { invoiceEntry } from './clients'
import { empty, entry, form, h, hidden, owner, panel, rows, stamp, status } from './shared'

function reminders(s: any) {
  const list = rows(s, 'drafts').filter(d => d.type === 'reminder').map(d => entry(`Reminder to ${d.payload.to}`, `<p>${status(d.status)} Prepared by ${h(d.prepared_by)} (${h(d.prepared_role)}) ${stamp(d.prepared_at)}</p><pre>Subject: ${h(d.payload.subject)}\n\n${h(d.payload.body)}</pre>`
    + (d.status === 'draft' ? form('reminder.approve', '/app/invoices', hidden('id', d.id), 'Approve this exact text') : `<p><a href="/api/balm/reminders/${h(d.id)}.txt">Download approved reminder</a></p>`))).join('')
  return panel('Appointment reminders', '<p>Balm prepares the exact reminder text; after approval you download it and send it your usual way. Balm sends nothing.</p>' + (list || empty('No reminders yet. Prepare one from an upcoming appointment in a client file.')))
}

export function invoices(s: any) {
  const all = rows(s, 'invoices')
  const drafts = all.filter(i => i.status === 'draft'), issued = all.filter(i => i.status !== 'draft')
  const history = owner(s) ? panel('Approval history', rows(s, 'approvals').length ? rows(s, 'approvals').map(a => entry(`${a.subject_type} approved by ${a.approved_by}`, `<p>${stamp(a.approved_at)} · prepared by ${h(a.prepared_by)} (${h(a.prepared_role)})</p><p class="help">SHA-256 of the approved content: <code>${h(a.sha256)}</code></p>`)).join('') : empty('Approved invoices, reminders and intake forms are recorded here.'), 'full') : ''
  return `<h1>Invoices and reminders</h1><p>Invoices are prepared from attended appointments, by staff or an agent, and numbered only when a person approves them. Payment and any insurance claim happen outside Balm; record payments you receive here.</p>
    <div class="grid">${panel('Waiting for approval', drafts.map(i => invoiceEntry(s, i, '/app/invoices')).join('') || empty('Nothing waiting.'))}${panel('Issued invoices', issued.map(i => invoiceEntry(s, i, '/app/invoices')).join('') || empty('No invoices issued yet.'))}${reminders(s)}${history}</div>`
}
