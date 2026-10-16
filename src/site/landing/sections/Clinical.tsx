import { ArrowRight, Avatar, Check, Feature, Icon } from '../parts'

/** Marcus's daily note with its billed units, beside the copy. */
export function Documentation() {
  return <Feature id="documentation" eyebrow="Documentation" title={<>Notes signed before <br />the next visit.</>} label="Daily note for Marcus Thompson, Mar 12. Subjective: knee pain 3/10, stairs easier. Objective: knee flexion 0 to 118 degrees. Billed 97110 x2 and 97140 x1, 38 minutes: 3 units under the 8-minute rule. Drafted by the scribe, signed by Sarah Lee, PT."
    art={<div className="card note-card">
      <div className="note-head"><Avatar initials="MT" tone="mint" /><p>Daily note · Marcus Thompson</p><p className="note-date">Mar 12</p></div>
      <div className="note-line"><span className="tag">S</span><p>Knee pain 3/10, stairs easier</p></div>
      <div className="note-line"><span className="tag">O</span><p>Knee flexion 0–118°</p></div>
      <div className="note-line billed"><span className="tag">Billed</span><p>97110 x2 · 97140 x1 · 38 min</p></div>
      <p className="pill pill-green units">8-minute rule · 3 units</p>
      <div className="note-foot"><p>Drafted by scribe · Signed by Sarah Lee, PT</p><Check /></div>
    </div>}>
    PT, OT and speech templates for evaluations, daily notes, progress and discharge. The scribe drafts from the visit; you review and sign.
  </Feature>
}

/** Claim #10482 from eligibility to the ERA, and a denial that came back with its fix. */
export function Billing() {
  return <Feature id="billing" flip eyebrow="Insurance billing" title={<>Claims that come <br />back paid.</>} label="Claim 10482 for Ana Ramirez with Aetna: eligibility verified Mar 1; authorization, 8 of 12 visits left; sent via Claim.MD Mar 12; paid $142.18, ERA posted Mar 19. Another claim denied CO-197 for no authorization: the authorization was attached and it was resubmitted Mar 8."
    art={<>
      <div className="card claim-card">
        <p className="claim-title">Claim #10482 · Ana Ramirez · Aetna</p>
        <ol className="timeline">
          <li><Check /><p>Eligibility verified <span>· Mar 1</span></p></li>
          <li><Check /><p>Authorization <span>· 8 of 12 visits left</span></p></li>
          <li><Check /><p>Sent via Claim.MD <span>· Mar 12</span></p></li>
          <li><Check /><p>Paid $142.18 <span>· ERA posted Mar 19</span></p></li>
        </ol>
      </div>
      <p className="denial-chip"><span className="chip-icon tone-coral small"><Icon name="alert" /></span><span className="denial-text">Denied CO-197: no authorization <ArrowRight /> auth attached, resubmitted Mar 8</span><Check /></p>
    </>}>
    Check eligibility, track authorizations and send claims through Claim.MD or Availity. Payments post from the ERA, and denials arrive with the fix.
  </Feature>
}
