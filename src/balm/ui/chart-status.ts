// Documentation status on the schedule: each visit's note (signed, not signed
// or missing once attended), the client's plan of care, and the visits whose
// note still needs a signature. Statuses only: no note text reaches these views.
import { avatar, desk, h, panel, rows, status, usDate, when, zoneOf } from './shared'

const SHOWN = 4

export const noteChip = (a: any) => a.note_status === 'signed' ? status('Note signed') : a.note_status === 'unsigned' ? status('Note not signed') : a.status === 'attended' ? status('No note yet') : ''

export function planChip(s: any, a: any) {
  if (!a.plan_of_care) return ''
  const [state, at, physician] = String(a.plan_of_care).split('|')
  return state === 'certified' ? status(`Plan of care signed by ${physician} · ${usDate(at, zoneOf(s))}`) : status(`Plan of care sent to ${physician} · not signed`)
}

/** "All 14 notes signed" or "12 of 14 notes signed" for the attended visits shown. */
export function notesTally(appointments: any[]) {
  const due = appointments.filter(a => a.status === 'attended')
  if (!due.length) return ''
  const signed = due.filter(a => a.note_status === 'signed').length
  return `<p>${status(signed === due.length ? `All ${due.length} ${due.length === 1 ? 'note' : 'notes'} signed` : `${signed} of ${due.length} notes signed`)}</p>`
}

/** Attended visits of the last two weeks whose note is missing or unsigned. */
export function notesToSign(s: any) {
  const mine = s.actor.staffId
  if (!desk(s) && !mine) return ''
  const visible = rows(s, 'appointments').filter(a => desk(s) || a.practitioner_id === mine)
  const unsigned = visible.filter(a => (a.status === 'attended' || a.note_status === 'unsigned') && a.note_status !== 'signed' && Date.parse(a.start_at) <= Date.now())
  if (!unsigned.length) return visible.some(a => a.status === 'attended') ? panel('Notes to sign', `<p>${status('All notes signed')} Every attended visit of the last two weeks has a signed note.</p>`, 'facts notes-due') : ''
  const row = (a: any) => `<li>${avatar(a.client)}<a href="/app/clients/${h(a.client_id)}">${h(a.client)}</a><span>${h(a.service)} with ${h(a.practitioner)}</span><span>${when(s, a.start_at)}</span>${a.note_status === 'unsigned' ? status('Note not signed') : status('No note yet')}</li>`
  // The oldest few show at once; the rest stay on the page behind one disclosure.
  const rest = unsigned.slice(SHOWN)
  return panel('Notes to sign', `<p class="help">Attended visits whose note is not signed yet, oldest first.</p><ul class="due">${unsigned.slice(0, SHOWN).map(row).join('')}</ul>`
    + (rest.length ? `<details><summary>Show all ${unsigned.length}</summary><ul class="due">${rest.map(row).join('')}</ul></details>` : ''), 'facts notes-due')
}
