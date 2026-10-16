import { Avatar, Check, Feature } from '../parts'

/** Lena's March statement with its pay link, beside the copy. */
export function Payments() {
  return <Feature id="payments" eyebrow="Patient payments" title={<>Patients pay <br />in one tap.</>} label="Statement for Lena Ortiz, March 2026: Mar 4 copay $30.00, paid with the card ending 4242; Mar 11 deductible $86.40; balance due $86.40, with a Pay now button. The payment link was sent by text and paid Mar 13."
    art={<>
      <div className="card statement-card">
        <p className="statement-title">Statement · Lena Ortiz · March 2026</p>
        <div className="statement-row"><p>Mar 4 · Copay</p><p className="amt">$30.00</p><p className="paid"><Check className="check solid" />paid, card ending 4242</p></div>
        <div className="statement-row"><p>Mar 11 · Deductible</p><p className="amt">$86.40</p></div>
        <div className="statement-total"><p>Balance due</p><p className="amt">$86.40</p></div>
        <p className="pay-now">Pay now</p>
      </div>
      <p className="ok-chip"><Check className="check solid" />Payment link sent by text · paid Mar 13</p>
    </>}>
    Cards on file, text-to-pay links, superbills and clear statements. Copays collect at check-in.
  </Feature>
}

/** A text reminder thread answered with one letter. */
export function Reminders() {
  return <Feature id="reminders" flip eyebrow="Reminders" title={<>Reminders patients <br />answer.</>} label="A text thread from Riverside Physical Therapy: Hi Ana, see you Thursday at 10:30 with Sarah. Reply C to confirm or R to reschedule. Ana replies C. Confirmed. See you Thursday! Tomorrow, 46 of 48 confirmed."
    art={<>
      <div className="card thread-card">
        <div className="thread-head"><Avatar initials="RP" tone="sky" /><p>Riverside Physical Therapy</p></div>
        <div className="thread">
          <p className="bubble in">Hi Ana, see you Thursday at 10:30 with Sarah. Reply C to confirm or R to reschedule.</p>
          <p className="bubble out">C</p>
          <p className="bubble in">Confirmed. See you Thursday!</p>
        </div>
      </div>
      <p className="ok-chip sky"><Check className="check solid" />Tomorrow · 46 of 48 confirmed</p>
    </>}>
    Text and email reminders go out on their own. Patients confirm or ask for a new time in one reply.
  </Feature>
}
