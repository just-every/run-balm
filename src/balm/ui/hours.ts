// A practitioner's weekly hours as a form: each day works or not, a start and an
// end time, and any breaks. src/balm/forms.ts turns the posted fields into the
// `hours` windows `hours.save` stores; agents can still send those windows directly.
import { form, h, hidden, rows } from './shared'

export const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday first, the way a clinic's week reads. */
const order = [1, 2, 3, 4, 5, 6, 0]
export const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const clockText = (m: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2026, 0, 1, 0, m)))

const time = (name: string, label: string, value: string) => `<label>${h(label)}<input type="time" name="${h(name)}" value="${h(value)}" step="300"></label>`

function day(weekday: number, windows: any[], fresh: boolean) {
  const works = windows.length > 0 || (fresh && weekday >= 1 && weekday <= 5)
  const start = windows.length ? clock(windows[0].start_minute) : works ? '09:00' : ''
  const end = windows.length ? clock(windows[windows.length - 1].end_minute) : works ? '17:00' : ''
  // The gaps between saved windows are the breaks; one more empty break row is always offered.
  const breaks = windows.slice(1).map((w, i) => [clock(windows[i].end_minute), clock(w.start_minute)])
  const breakRows = [...breaks, ['', '']].map(([from, until], i) => `<div class="pair">${time(`d${weekday}_break${i}_start`, i ? 'Another break from' : 'Break from (optional)', from)}${time(`d${weekday}_break${i}_end`, 'Break until', until)}</div>`).join('')
  return `<fieldset class="hours-day"><legend>${days[weekday]}</legend><label class="check"><input type="checkbox" name="d${weekday}_open" value="on"${works ? ' checked' : ''}><span>Works on ${days[weekday]}</span></label>`
    + `<div class="pair">${time(`d${weekday}_start`, 'Starts', start)}${time(`d${weekday}_end`, 'Ends', end)}</div>${breakRows}</fieldset>`
}

/** The saved hours as a list, and the form to change them. */
export function hoursFor(s: any, p: any) {
  const mine = rows(s, 'hours').filter(w => w.practitioner_id === p.id)
  const byDay = (d: number) => mine.filter(w => w.weekday === d).sort((a, b) => a.start_minute - b.start_minute)
  const summary = mine.length ? `<ul class="plain">${order.filter(d => byDay(d).length).map(d => `<li>${days[d]} ${byDay(d).map(w => `${clockText(w.start_minute)}–${clockText(w.end_minute)}`).join(', ')}</li>`).join('')}</ul>`
    : '<p class="empty">No hours yet: nobody can book this practitioner.</p>'
  const fields = hidden('practitionerId', p.id) + hidden('hoursForm', 'on') + order.map(d => day(d, byDay(d), !mine.length)).join('')
    + `<p class="help">Times are clock times in the clinic’s time zone (${h(s.settings.time_zone)}). Untick a day the practitioner does not work. A break splits the day: nobody can book inside it.</p>`
  return summary + `<details${mine.length ? '' : ' open'}><summary>Set weekly hours</summary>${form('hours.save', '/app/clinic', fields, 'Save hours')}</details>`
}
