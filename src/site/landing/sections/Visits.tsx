import type { CSSProperties } from 'react'
import { clinic, dayOf, patient, SPAN, visits } from '../episode'
import { Avatar, Check, Copy, Icon, Stage } from '../parts'

const at = (day: number) => ({ '--at': (day / SPAN).toFixed(4) }) as CSSProperties
const label = (v: typeof visits[number], i: number) => i === 0 || (v.month === 'Apr' && visits[i - 1].month === 'Mar') ? `${v.month} ${v.day}` : String(v.day)
/** The month rules split between Mar 31 and Apr 2. */
const SPLIT = (dayOf('Mar', 31) + dayOf('Apr', 2)) / 2

/** 05: Ana's sixteen Tue/Thu visits on one line, the Apr 23 visit moved by a text reply and the opened slot taken
 * from the waitlist. Phones read the visits as a two-month list. */
export function Visits() {
  return <Stage id="visits" ground="05">
    <Copy id="visits" eyebrow="Visits" title="Sixteen visits, all kept.">
      Reminders go out by text. Patients reschedule by reply, and the open slot goes to your waitlist.
    </Copy>
    <div className="visit-track">
      <p className="track-who"><strong>{patient.name}</strong><span> · </span>Tue 9:00 and Thu 10:30 with Sarah Lee</p>
      <p className="track-kept">16 of 16 kept<Check className="check solid" /></p>
      <div className="track">
        <ol className="track-line" aria-label={`Sixteen visits: ${visits.map(v => `${v.weekday} ${v.month} ${v.day}, ${v.time}`).join('; ')}`}>
          {visits.map((v, i) => <li key={i} className={v.moved ? 'moved' : undefined} style={at(dayOf(v.month, v.day))}>
            <span className="dot" aria-hidden="true" /><span aria-hidden="true">{label(v, i)}</span>
          </li>)}
        </ol>
        <p className="moved-flag" style={at(dayOf('Apr', 24))}><svg viewBox="0 0 24 16" aria-hidden="true"><path d="M3 13c3-7 9-10 17-8M15 2l5 3-4 4" /></svg><span>Moved Thu → Fri · Apr 24, 9:15</span></p>
        <div className="months" aria-hidden="true"><p style={{ '--to': (SPLIT / SPAN).toFixed(4) } as CSSProperties}>March</p><p style={{ '--from': (SPLIT / SPAN).toFixed(4) } as CSSProperties}>April</p></div>
      </div>
    </div>
    <div className="visit-list">
      {(['Mar', 'Apr'] as const).map(month => <div key={month}>
        <p className="list-month">{month === 'Mar' ? 'March' : 'April'}</p>
        <ul>{visits.filter(v => v.month === month).map(v => <li key={v.day} className={v.moved ? 'moved' : undefined}>
          <span className="dot" aria-hidden="true" /><p>{v.weekday} {v.month} {v.day} · {v.time}{v.moved && <span>Moved Thu → Fri · 9:15</span>}</p>
        </li>)}</ul>
      </div>)}
    </div>
    <div className="visit-cards">
      <article className="card thread-card">
        <h3 className="card-title">{clinic}</h3>
        <div className="thread">
          <p className="bubble in">Hi Ana, see you Thu at 10:30 with Sarah. Reply C to confirm or R to reschedule.</p>
          <p className="bubble out">R</p>
          <p className="bubble in">Fri 9:15 is open. Reply Y to take it.</p>
          <p className="bubble out">Y</p>
          <p className="bubble in">Moved. See you Friday.</p>
        </div>
      </article>
      <article className="card waitlist-card">
        <h3 className="card-title">Thu Apr 23 · 10:30 opened</h3>
        <ol className="waitlist-steps">
          <li><span className="chip-icon tone-sky"><Icon name="people" /></span><p>Offered to 3 on the waitlist</p></li>
          <li><Avatar initials="DM" tone="mint" /><p>Taken by David Moore · 4 min</p><Check className="check solid" /></li>
          <li><span className="chip-icon tone-sky"><Icon name="calendarPlain" /></span><p>Calendar full again</p><Check className="check solid" /></li>
        </ol>
      </article>
    </div>
  </Stage>
}
