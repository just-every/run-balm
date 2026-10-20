// The day sheet (SCHED-002): one clinic-local day of the calendar the actor may
// see, every visit with its status and flags, as a page to print and as a CSV.
// The same columns and filter as the day view (by practitioner, room or equipment).
import { csvCell } from '../domain/disclosures'
import { local, span, statusLabel } from './calendar'
import { h, money } from './shared'

const intake = (a: any) => a.intake_received ? 'Received' : a.intake_on_file ? 'On file' : 'Due'
const authorization = (a: any) => a.authorization ? `${a.authorization.left} of ${a.authorization.total} ${a.authorization.kind} left (${a.authorization.number}, ends ${a.authorization.endsOn})${a.authorization.covered === false ? ' · not covered by the current authorization' : ''}` : ''

/** The day's visits in time order, each once, limited to the calendar's chosen column when one is chosen. */
function sheetRows(c: any) {
  const pick = c.subject && c.by !== 'practitioner' ? (a: any) => (c.by === 'room' ? (c.subject === 'none' ? !a.room_id : a.room_id === c.subject) : a.equipment_id === c.subject)
    : c.subject ? (a: any) => a.practitioner_id === c.subject : () => true
  return c.appointments.filter((a: any) => local(a.start_at, c.zone).date === c.date && pick(a))
}
/** Balance appears only when the calendar carried it (reception and the owner). */
const columns = (c: any) => {
  const money_ = c.appointments.some((a: any) => 'balance_cents' in a)
  const cols: [string, (a: any) => string][] = [
    ['Time', a => span(a.start_at, a.end_at, c.zone)], ['Patient', a => a.client], ['Practitioner', a => a.practitioner], ['Service', a => a.service],
    ['Room', a => a.room ?? ''], ['Equipment', a => a.equipment ?? ''], ['Status', a => statusLabel[a.status] ?? a.status], ['Intake', intake],
    ['Authorization', authorization], ['Payer', a => a.payer ?? 'Self-pay'],
  ]
  if (money_) cols.push(['Balance owed', a => money(Number(a.balance_cents ?? 0))])
  return cols
}
export function daySheetCsv(c: any) {
  const cols = columns(c)
  return [cols.map(([label]) => csvCell(label)).join(','), ...sheetRows(c).map((a: any) => cols.map(([, value]) => csvCell(value(a))).join(','))].join('\r\n') + '\r\n'
}
export function daySheetHtml(c: any, clinic: string) {
  const cols = columns(c), list = sheetRows(c)
  const title = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(c.date + 'T00:00:00Z'))
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Day sheet · ${h(c.date)}</title>`
    + '<style>body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#1d2a26}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccd;padding:6px;text-align:left;vertical-align:top}@media screen and (max-width:600px){body{margin:16px}thead{display:none}table,tbody,tr{display:block}tr{border:1px solid #ccd;border-radius:8px;padding:8px;margin-bottom:12px}td{display:grid;grid-template-columns:7rem 1fr;gap:8px;border:0;overflow-wrap:anywhere}td:before{content:attr(data-label);font-weight:600}}@media print{body{margin:0}}</style></head><body>'
    + `<h1>Day sheet · ${h(title)}</h1><p>${h(clinic)} · ${h(c.zone)} · ${list.length} ${list.length === 1 ? 'visit' : 'visits'}</p>`
    + (list.length ? `<table><thead><tr>${cols.map(([label]) => `<th>${h(label)}</th>`).join('')}</tr></thead><tbody>${list.map((a: any) => `<tr>${cols.map(([label, value]) => `<td data-label="${h(label)}">${h(value(a))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>No visits this day.</p>')
    + '</body></html>'
}
