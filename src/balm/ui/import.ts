// Move in from Cliniko: upload Cliniko's patient export, read the preview as a
// table, apply that exact preview, then read each import's result and journal.
import { dateFormats } from '../movein/csv'
import { fileField } from '../forms'
import { clientName, empty, entry, form, h, hidden, panel, result, rows, usDate, zoneOf } from './shared'

const states: Record<string, string> = {
  queued: 'Waiting to start', applying: 'Importing', completed: 'Imported', failed: 'Stopped before finishing',
  undoing: 'Undoing', undone: 'Undone', rolling_back: 'Rolling back', rolled_back: 'Rolled back',
}
const reasons: Record<string, string> = { edited: 'Kept: booked, edited or given notes in Balm since the import', dependency: 'Kept: has bookings, notes or invoices in Balm' }
const conflictText: Record<string, string> = { existing_client_requires_review: 'Already in Balm (same Cliniko ID or same name, birth date and email)', erased_identity: 'Erased from Balm before: cannot be imported again' }
const formatLabel = (value: string) => dateFormats.find(([f]) => f === value)?.[1] ?? value
const table = (head: string[], body: string[][]) => `<div class="table"><table><thead><tr>${head.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const plural = (n: number) => `${n} patient${n === 1 ? '' : 's'}`
const progress = (j: any) => j.undo ? `Undone: ${h(j.undo.removed)} of ${h(plural(Number(j.total)))} removed, ${h(j.undo.kept)} kept because they were booked, edited or given notes in Balm since`
  : `${states[j.state] ?? h(j.state)}: ${h(j.checkpoint)} of ${h(plural(Number(j.total)))}`

function preview(s: any, notice: any) {
  const data = result(notice)
  if (!data?.fingerprint || !Array.isArray(data.clients) || !Array.isArray(data.conflicts)) return ''
  const conflicts = new Map<string, string>(data.conflicts.map((c: any) => [c.clientId, c.reason]))
  const ambiguous = new Map<string, string>((data.diagnostics ?? []).filter((d: any) => d.code === 'ambiguous_date').map((d: any) => [d.sourceId, d.message]))
  const list = table(['Patient', 'Date of birth', 'Email', 'Mobile', 'Cliniko ID', 'Check'], data.clients.map((c: any) => {
    const source = String(c.id).replace(/^cliniko-/, '')
    const flag = conflicts.has(c.id) ? `<strong>${h(conflictText[conflicts.get(c.id)!] ?? conflicts.get(c.id))}</strong>` : ambiguous.has(source) ? `<strong>Check the date of birth</strong>` : 'Ready'
    return [h(`${c.first_name} ${c.last_name}`), h(usDate(c.date_of_birth, zoneOf(s))), h(c.email ?? '—'), h(c.phone ?? '—'), h(source), flag]
  }))
  const reread = form('import.preview', '/app/import', hidden('csvBase64', fileField(data.csv)) + hidden('fileName', data.fileName ?? '') + `<label>Read the dates as<select name="dateFormat">${dateFormats.map(([value, label]) => `<option value="${value}"${value === data.dateFormat ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`, 'Preview again with this date format', true)
  const dateNote = `<p>Dates of birth were read as <strong>${h(formatLabel(data.dateFormat))}</strong>. If they look wrong, change the date format and preview again.</p><details><summary>Change the date format</summary>${reread}</details>`
  const warnings = ambiguous.size ? `<div class="notice" role="status"><p><strong>${ambiguous.size} date${ambiguous.size === 1 ? '' : 's'} of birth could be read either way.</strong> Balm used the format above and changed nothing; check ${ambiguous.size === 1 ? 'it' : 'them'} against Cliniko before importing.</p><ul>${[...ambiguous.values()].map(m => `<li>${h(m)}</li>`).join('')}</ul></div>` : ''
  const apply = data.conflicts.length
    ? `<p><strong>${data.conflicts.length} patient${data.conflicts.length === 1 ? ' is' : 's are'} already in Balm or ${data.conflicts.length === 1 ? 'was' : 'were'} erased.</strong> Remove ${data.conflicts.length === 1 ? 'that row' : 'those rows'} from the file and preview it again; nothing has been imported.</p>`
    : form('import.apply', '/app/import', hidden('csvBase64', fileField(data.csv)) + hidden('dateFormat', data.dateFormat) + hidden('fingerprint', data.fingerprint)
      + `<label class="check"><input type="checkbox" required><span>I checked these ${data.clients.length} patients and want to import them.</span></label>`, `Import ${data.clients.length} patient${data.clients.length === 1 ? '' : 's'}`)
  return panel(`Preview${data.fileName ? `: ${data.fileName}` : ''} · ${data.clients.length} patient${data.clients.length === 1 ? '' : 's'}`, `<p>Nothing is imported yet. Check each patient below.</p>${dateNote}${warnings}${list}${apply}`, 'full')
}

function journal(s: any, notice: any) {
  const data = result(notice)
  if (!data?.job) return ''
  const j = data.job, names = new Map(rows(s, 'clients').map((c: any) => [c.id, clientName(c)]))
  const done = data.undo?.dispositions?.length ? data.undo.dispositions.filter((d: any) => d.disposition === 'reversed').length : null
  const summary = `<p><strong>${progress(done === null ? j : { ...j, undo: { removed: done, kept: data.undo.dispositions.length - done } })}</strong>${j.error ? `<br>Stopped because: ${h(j.error)}` : ''}</p>`
  if (!data.undo) return panel('Import result', summary + '<p>Open the import’s journal below for its original file and any undo.</p>', 'full')
  const original = (data.originals ?? []).map((o: any) => o.available ? `<p>Original file (${Number(o.size).toLocaleString('en-US')} bytes), exactly as uploaded: <a href="/api/balm/imports/${h(j.id)}/original.csv">Download the original file</a></p>` : '<p>The original file is no longer kept.</p>').join('')
  const who = (d: any) => names.get(d.targetId) ?? (d.redacted ? 'Erased patient' : `Cliniko ID ${String(d.targetId).replace(/^cliniko-/, '')}`)
  const undo = data.undo.dispositions.length ? `<h3>Undo result</h3>${table(['Patient', 'What happened'], data.undo.dispositions.map((d: any) => [h(who(d)), h(d.disposition === 'reversed' ? 'Removed from Balm' : reasons[d.reason] ?? d.reason)]))}`
    : `<p>${j.state === 'completed' ? 'Not undone. Undo removes the imported patients and keeps anyone booked, edited or given notes in Balm since.' : ''}</p>`
  return panel('Import journal', summary + original + undo, 'full')
}

export function movein(s: any, notice: any) {
  const jobs = rows(s, 'importJobs').map(j => {
    const controls = form('import.journal', '/app/import', hidden('jobId', j.id), 'View journal', true)
      + (['queued', 'applying', 'failed', 'undoing', 'rolling_back'].includes(j.state) ? form('import.resume', '/app/import', hidden('jobId', j.id), 'Continue this import') : '')
      + (j.state === 'completed' ? `<details class="confirm"><summary>Undo this import</summary>${form('import.undo', '/app/import', hidden('jobId', j.id) + '<label class="check"><input type="checkbox" required><span>Remove the imported patients. Anyone booked, edited or given notes since stays.</span></label>', 'Undo import', true)}</details>` : '')
      + (['queued', 'applying', 'failed'].includes(j.state) ? `<details class="confirm"><summary>Roll back this unfinished import</summary>${form('import.rollback', '/app/import', hidden('jobId', j.id) + '<label class="check"><input type="checkbox" required><span>Remove what this unfinished import added.</span></label>', 'Roll back', true)}</details>` : '')
    return entry(`Import of ${j.total} patient${Number(j.total) === 1 ? '' : 's'}`, `<p>${progress(j)}${j.error ? `<br>Stopped because: ${h(j.error)}` : ''}</p><div class="actions">${controls}</div>`)
  }).join('')
  const how = `<ol class="steps"><li>In Cliniko, go to <strong>Settings → Data &amp; docs → Data exports</strong> (Cliniko administrators only).</li><li>Choose <strong>Patients</strong>, set both dates to <strong>Any time</strong>, and select <strong>Export data</strong>.</li><li>When the export is ready, download it: a CSV file named like <code>Patients-Cliniko-20261017.csv</code>.</li><li>Upload that file here as it is. Balm reads the patient ID, first and last name, date of birth, email and mobile, and leaves the other columns out.</li></ol>`
  const upload = `<form method="post" enctype="multipart/form-data" action="/app/action?name=import.preview&amp;returnTo=%2Fapp%2Fimport"><label>Cliniko patient export (.csv)<input type="file" name="file" accept=".csv,text/csv" required></label>`
    + `<label>Dates in the file are written as<select name="dateFormat">${dateFormats.map(([value, label]) => `<option value="${value}"${value === (result(notice)?.dateFormat ?? 'MDY') ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`
    + '<p class="help">Up to 1000 patients and 1 MB per file; for more, export a smaller date range in Cliniko and import each file in turn.</p><button type="submit">Preview patients</button></form>'
  return `<h1>Move in from Cliniko</h1><p>Bring your patient list across from Cliniko. You see every patient before anything is imported, and you can undo an import later: anyone booked, edited or given notes in Balm since is kept. Only patient details move; appointments, notes and invoices stay in Cliniko.</p>${preview(s, notice)}${journal(s, notice)}<div class="grid">${panel('Upload your Cliniko export', how + upload)}${panel('Imports', jobs || empty('No imports yet.'))}</div>`
}
