import { dateFormats } from '../movein/csv'
import { fileField } from '../forms'
import { dollarsField, empty, entry, field, form, h, hidden, money, panel, practitioners, result, rows, select, services, textarea, when, zoneOf } from './shared'

const providers: [string, string][] = [['cliniko', 'Cliniko'], ['webpt', 'WebPT'], ['simplepractice', 'SimplePractice'], ['jane', 'Jane']]
const table = (heads: string[], body: string[][]) => `<div class="table"><table><thead><tr>${heads.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const label = (s: any) => providers.find(([id]) => id === s)?.[1] ?? s

function upload(s: any) {
  const files = [['patients', 'Patients (required)'], ['appointments', 'Appointments'], ['notes', 'Historical text documents'], ['balances', 'Opening balances'], ['insurance', 'Insurance policies']]
  const body = select('provider', 'Move from', providers, 'cliniko')
    + files.map(([kind, text]) => `<label>${h(text)} (.csv)<input type="file" name="${kind}" accept=".csv,text/csv" ${kind === 'patients' ? 'required' : ''}></label>`).join('')
    + select('dateFormat', 'Dates in the files', dateFormats, 'MDY')
    + select('practitionerId', 'Assign appointments to', [['', 'Choose a practitioner'], ...practitioners(s).map(p => [p.id, p.name] as [string, string])], '', '')
    + select('serviceId', 'Appointment service', [['', 'Choose a service'], ...services(s).map(p => [p.id, p.name] as [string, string])], '', '')
    + field('expectedPatients', 'Patient count reported by your old system (optional)', '', 'number', 'min="0" step="1"')
    + '<p class="help">Up to 100 records per bundle and 1 MB per file. Use one practitioner and service per bundle. Original exports may need conversion: check the supported columns before uploading.</p>'
    + '<button type="submit">Preview move-in</button>'
  return panel('Upload and map your files', '<p><a href="https://run-balm.com/docs/move-in-formats">Supported exports and conversion columns</a>. Cliniko patient CSVs are read directly. Other reports use the mapped CSV columns in the guide. ZIP, PDF and Excel packages need preparation; this screen does not read them.</p><form method="post" enctype="multipart/form-data" action="/app/action?name=movein.preview&amp;returnTo=%2Fapp%2Fimport">' + body + '</form>')
}

function totals(data: any, input: any) {
  const r = data.reconciliation, source = r.source, planned = r.planned
  const expected = input.expectedTotals ?? {}
  const names = new Map(data.patients.map((p: any) => [p.sourceId, `${p.firstName} ${p.lastName}`]))
  const compare = [[h('Patients'), field('expectedPatients', 'Source patients', source.patients, 'number', 'min="0" step="1" required'), h(planned.patients)]]
  for (const month of [...new Set([...Object.keys(source.appointmentsByMonth), ...Object.keys(planned.appointmentsByMonth)])].sort()) compare.push([h(`Appointments · ${month}`), field('month_' + month, `Source appointments in ${month}`, expected.appointmentsByMonth?.[month] ?? source.appointmentsByMonth[month] ?? 0, 'number', 'min="0" step="1" required'), h(planned.appointmentsByMonth[month] ?? 0)])
  for (const id of [...new Set([...Object.keys(source.balancesByPatient), ...Object.keys(planned.balancesByPatient)])].sort()) compare.push([h(`Open balance · ${names.get(id) ?? id} (${id})`), field('balance_' + id, `Source balance for ${names.get(id) ?? id}`, dollarsField(expected.balancesByPatient?.[id] ?? source.balancesByPatient[id] ?? 0), 'text', 'inputmode="decimal" required'), h(money(planned.balancesByPatient[id] ?? 0))])
  compare.push([h('Historical documents'), h(source.documents), h(planned.documents)], [h('Insurance policies'), h(source.insurance), h(planned.insurance)])
  return '<h3>Reconcile before switching</h3><p>Compare the file with the totals reported by your old system. Enter a different source total and choose <strong>Check totals again</strong> to see each difference. Balances are opening balances, separate from Balm invoices.</p>' + table(['Total', 'Source / file', 'Balm after import'], compare)
}

function preview(s: any, notice: any) {
  const data = result(notice)
  if (!data?.reconciliation || !data.fingerprint || !data.reviewInput) return ''
  const input = data.reviewInput
  const diagnostics = [...(data.diagnostics ?? []).map((d: any) => `${d.file || 'Bundle'}${d.row ? `, row ${d.row}` : ''}${d.column ? `, column ${d.column}` : ''}: ${d.message}`), ...(data.unmappedColumns ?? []).map((d: any) => `${d.file}: column “${d.column}” is not imported`), ...(data.unmappedRows ?? []).map((d: any) => `${d.file}, row ${d.row}: ${d.reason}`)]
  const errors = (data.diagnostics ?? []).some((d: any) => d.severity === 'error')
  const names = new Map(data.patients.map((p: any) => [p.sourceId, `${p.firstName} ${p.lastName}`]))
  const differenceLabel = (m: any) => {
    if (String(m.metric).startsWith('balancesByPatient:')) return `Open balance for ${names.get(m.metric.slice(18)) ?? m.metric.slice(18)}: source ${money(m.source)}, Balm ${money(m.planned)}`
    if (String(m.metric).startsWith('appointmentsByMonth:')) return `Appointments in ${m.metric.slice(20)}: source ${m.source}, Balm ${m.planned}`
    return `${({ patients: 'Patients', documents: 'Historical documents', insurance: 'Insurance policies' } as Record<string, string>)[m.metric] ?? 'Total'}: source ${m.source}, Balm ${m.planned}`
  }
  const differences = data.reconciliation.mismatches ?? []
  const differenceText = differences.length ? '<div class="notice" role="status"><strong>Totals differ. Apply is blocked until you resolve or explicitly accept the differences.</strong><ul>' + differences.map((m: any) => `<li>${h(typeof m === 'string' ? m : differenceLabel(m))}</li>`).join('') + '</ul></div>' : '<p><strong>All compared totals match.</strong></p>'
  const counts = table(['Record', 'Source ID / patient', 'File and row', 'Preview'], [
    ...data.patients.map((p: any) => ['Patient', h(p.sourceId), h(`${p.file}, row ${p.row}`), h(`${p.firstName} ${p.lastName} · ${p.dateOfBirth ?? 'No birth date'}`)]),
    ...data.appointments.map((a: any) => ['Appointment', h(`${a.sourceId} / ${a.patientId}`), h(`${a.file}, row ${a.row}`), `${when(s, a.startAt)} · ${h(a.status)}`]),
    ...data.notes.map((n: any) => ['Read-only document', h(`${n.sourceId} / ${n.patientId}`), h(`${n.file}, row ${n.row}`), h(n.title)]),
    ...data.insurance.map((p: any) => ['Insurance', h(`${p.sourceId} / ${p.patientId}`), h(`${p.file}, row ${p.row}`), h(`${p.payer} · ${p.memberId}`)]),
  ])
  const carry = hidden('bundleBase64', fileField(JSON.stringify(input))) + hidden('fingerprint', data.fingerprint)
  const acceptance = textarea('acceptanceReason', 'Reason for accepting differences or omitted columns (required if any remain)', input.acceptanceReason ?? '', 'maxlength="1000"')
  const actions = `<button type="submit" formnovalidate formaction="/app/action?name=movein.preview&amp;returnTo=%2Fapp%2Fimport">Check totals again</button>${errors ? '<p><strong>Fix the named errors in your files and upload again before applying.</strong></p>' : '<label class="check"><input type="checkbox" name="confirm" required><span>I reviewed the rows, totals and omissions. Apply this bundle as one change.</span></label><button type="submit">Apply move-in</button>'}`
  return panel(`${label(data.provider)} preview`, (data.existingJob ? `<p><strong>This bundle was already ${h(data.existingJob.state)}. Applying it again changes nothing.</strong></p>` : '') + '<p>Nothing has been imported by this preview. Re-importing unchanged records adds no duplicates. Undo removes the whole bundle; new work or edits block undo to protect the record.</p>' + (diagnostics.length ? '<h3>Columns and rows to review</h3><ul>' + diagnostics.map(d => `<li>${h(d)}</li>`).join('') + '</ul>' : '') + `<p>Appointment times are in ${h(zoneOf(s))}. Assigned practitioner and service apply to every appointment in this bundle.</p>` + counts + '<form method="post" action="/app/action?name=movein.apply&amp;returnTo=%2Fapp%2Fimport">' + carry + totals(data, input) + differenceText + acceptance + actions + '</form>', 'full')
}

function jobs(s: any, notice: any) {
  const data = result(notice)
  const last = data?.job?.provider ? `<p role="status"><strong>${h(label(data.job.provider))}: ${h(data.job.state)}.</strong> ${data.unchanged ? 'No records changed.' : ''}</p>` : ''
  return panel('Move-in history', last + (rows(s, 'moveinJobs').map(j => entry(`${label(j.provider)} · ${j.state}`, `<p>${h(j.created_at)} · ${h(j.id)}</p>` + form('movein.journal', '/app/import', hidden('jobId', j.id), 'View reconciliation', true) + (j.state === 'applied' ? `<details><summary>Undo this move-in</summary><p>All imported records are removed together. Any later edit or dependent clinical work blocks undo.</p>${form('movein.undo', '/app/import', hidden('jobId', j.id) + '<label class="check"><input type="checkbox" required><span>Remove this entire move-in.</span></label>', 'Undo entire move-in', true)}</details>` : ''))).join('') || empty('No bundle imports yet.')))
}

function savedReport(data: any) {
  const report = data?.job?.report, r = report?.reconciliation
  if (!r) return ''
  const body = [[h('Patients'), h(r.source.patients), h(r.planned.patients)]]
  for (const month of [...new Set([...Object.keys(r.source.appointmentsByMonth), ...Object.keys(r.planned.appointmentsByMonth)])].sort()) body.push([h('Appointments · ' + month), h(r.source.appointmentsByMonth[month] ?? 0), h(r.planned.appointmentsByMonth[month] ?? 0)])
  for (const patient of [...new Set([...Object.keys(r.source.balancesByPatient), ...Object.keys(r.planned.balancesByPatient)])].sort()) body.push([h('Open balance · ' + patient), h(money(r.source.balancesByPatient[patient] ?? 0)), h(money(r.planned.balancesByPatient[patient] ?? 0))])
  body.push([h('Historical documents'), h(r.source.documents), h(r.planned.documents)], [h('Insurance policies'), h(r.source.insurance), h(r.planned.insurance)])
  return panel('Saved reconciliation', `<p>${h(label(data.job.provider))} · ${h(data.job.state)}. These are the totals reviewed at import.</p>` + table(['Total', 'Source / file', 'Balm at import'], body)
    + `<p><strong>Owner acceptance:</strong> ${h(data.job.acceptance_reason || 'No differences accepted.')}</p>`
    + '<ul>' + (report.diagnostics ?? []).map((d: any) => `<li>${h(d.file || 'Bundle')}${d.row ? ', row ' + h(d.row) : ''}: ${h(d.message)}</li>`).join('')
    + (report.unmappedColumns ?? []).map((d: any) => `<li>${h(d.file)}: column ${h(d.column)} omitted</li>`).join('')
    + (report.unmappedRows ?? []).map((d: any) => `<li>${h(d.file)}, row ${h(d.row)}: ${h(d.reason)}</li>`).join('') + '</ul>', 'full')
}

export function bundleMovein(s: any, notice: any) {
  return `<h1>Move in</h1><p>Bring patients, appointments, historical text documents, opening balances and insurance across with a reviewed mapping. Native PDF and ZIP chart packages, claims, authorizations and payment history are not imported here.</p>${preview(s, notice)}${savedReport(result(notice))}<div class="grid">${upload(s)}${jobs(s, notice)}</div>`
}
