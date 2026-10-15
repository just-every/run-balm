import { empty, entry, exact, form, h, hidden, panel, result, rows, status, textarea } from './shared'

function preview(notice: any) {
 const data = result(notice)
 if (!data?.fingerprint || !Array.isArray(data.clients) || !Array.isArray(data.conflicts)) return ''
 const { csv, ...review } = data
 return panel('Review exact import preview', `<p>Review every client row, diagnostic and conflict below. The fingerprint binds this preview to the exact source and destination state.</p>${exact(review)}${data.conflicts.length ? '<p>Resolve the listed conflicts before importing: clients already in Balm need review, and erased identities cannot be imported again.</p>' : form('import.apply', '/app/import', hidden('csv', csv) + hidden('fingerprint', data.fingerprint) + '<label><input type="checkbox" required>I reviewed these exact client rows and approve this import.</label>', 'Apply this exact preview')}`)
}

export function movein(s: any, notice: any) {
 const data = result(notice)
 const journal = data?.job ? panel('Import result and journal', exact(data)) : ''
 const jobs = rows(s, 'importJobs').map(j => {
  const controls = form('import.journal', '/app/import', hidden('jobId', j.id), 'View journal, original source and undo report')
   + (['queued', 'applying', 'failed', 'undoing', 'rolling_back'].includes(j.state) ? form('import.resume', '/app/import', hidden('jobId', j.id), 'Resume import operation') : '')
   + (j.state === 'completed' ? form('import.undo', '/app/import', hidden('jobId', j.id) + '<label><input type="checkbox" required>I reviewed the journal and approve undoing this completed import.</label>', 'Undo completed import') : '')
   + (['queued', 'applying', 'failed'].includes(j.state) ? form('import.rollback', '/app/import', hidden('jobId', j.id) + '<label><input type="checkbox" required>I reviewed the journal and approve rolling back this unfinished import.</label>', 'Roll back unfinished import') : '')
  return entry(`Import ${j.id}`, `${status(j.state)}<p>Checkpoint: ${h(j.checkpoint)} of ${h(j.total)}</p>${exact(j)}<div class="actions">${controls}</div>`)
 }).join('')
 return `<h1>Move in from Cliniko</h1><p>Bring your patient list across from a Cliniko patient export: preview it, apply that exact preview, read the journal with the original file, and undo it if needed. Undo keeps any client who has since been booked, edited or given notes. Only client details move; appointments, notes and invoices stay in Cliniko.</p>${preview(notice)}${journal}<div class="grid">${panel('Preview a CSV', `<p>Use these exact column headers: <code>ID,First Name,Last Name,Date of Birth,Email,Mobile</code> (dates as YYYY-MM-DD or DD/MM/YYYY). Paste 1–1000 patient rows, up to 1,000,000 UTF-8 bytes. Quoted CSV fields are supported.</p>${form('import.preview', '/app/import', textarea('csv', 'Cliniko patient CSV', '', 'required spellcheck="false"'), 'Preview patients')}`)}${panel('Import jobs', jobs || empty('No imports yet. Preview your patient CSV to begin.'))}</div>`
}
