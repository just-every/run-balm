import { Avatar, Check, Feature, Icon } from '../parts'

/** Thursday's calendar with a waitlist fill, beside the copy. */
export function Scheduling() {
  return <Feature id="scheduling" eyebrow="Scheduling" title="A full day, every day." label="Thursday, Mar 26: 8:00 Lena Ortiz, daily note, twice a week; 9:15 David Moore, filled from the waitlist and confirmed by text; 10:30 Grace Huang, OT evaluation, new patient. Tom Baker canceled 9:15 and the slot was offered to 3 people on the waitlist."
    art={<>
      <div className="card day-card">
        <div className="day-head"><span className="chip-icon tone-sky"><Icon name="calendarPlain" /></span><p>Thursday, Mar 26</p></div>
        <div className="day-row"><Avatar initials="LO" tone="sage" /><p className="day-time">8:00</p><div><p className="day-name">Lena Ortiz</p><p className="day-sub">daily note · 2x a week</p></div></div>
        <div className="day-row"><Avatar initials="DM" tone="sky" /><p className="day-time">9:15</p><div><p className="day-name">David Moore</p><p className="day-sub">filled from waitlist</p></div><p className="pill pill-green"><Check className="check solid" />Confirmed by text</p></div>
        <div className="day-row"><Avatar initials="GH" tone="honey" /><p className="day-time">10:30</p><div><p className="day-name">Grace Huang</p><p className="day-sub">OT evaluation · new patient</p></div></div>
      </div>
      <p className="note-chip"><span className="chip-icon tone-honey small"><Icon name="clock" /></span>Tom Baker canceled 9:15 · offered to 3 on the waitlist</p>
    </>}>
    Recurring visits, waitlists and online booking keep the calendar full. When someone cancels, Balm offers the slot to your waitlist by text.
  </Feature>
}

/** Ana's intake checklist and her portal's home exercise, beside the copy. */
export function Intake() {
  return <Feature id="intake" flip eyebrow="Intake and portal" title={<>Paperwork done <br />before they arrive.</>} label="New patient Ana Ramirez: health history done; consent to treat signed Feb 11; insurance card, Aetna, front and back; medication list, reminder sent Feb 12. Her portal shows a home exercise: quad sets, 3 x 10, daily."
    art={<div className="intake-pair">
      <div className="card intake-card">
        <div className="intake-head"><span className="chip-icon tone-sage big"><Icon name="user" /></span><p>New patient · Ana Ramirez</p></div>
        <div className="intake-row"><Check className="check solid" /><p>Health history</p></div>
        <div className="intake-row"><Check className="check solid" /><p>Consent to treat <span>· signed Feb 11</span></p></div>
        <div className="intake-row"><Check className="check solid" /><p>Insurance card <span>· Aetna, front and back</span></p></div>
        <div className="intake-row"><span className="chip-icon tone-honey small"><Icon name="clock" /></span><p>Medication list <span>· reminder sent Feb 12</span></p></div>
      </div>
      <div className="card portal-card">
        <div className="portal-head"><span className="chip-icon tone-sky"><Icon name="dumbbell" /></span><p>Home exercises</p></div>
        <p className="portal-name">Quad sets</p><p className="portal-sub">3 x 10 · daily</p>
        <span className="play"><Icon name="play" /></span>
      </div>
    </div>}>
    Patients fill in intake, sign consent and add their insurance card from one link. Their home exercises and messages live in the same portal.
  </Feature>
}
