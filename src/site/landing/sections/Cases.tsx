import { Arrow } from '../../shell/Actions'
import { Check, Feature, Icon } from '../parts'

/** Marcus's case from referral to re-authorization, with the agent's drafted next step. */
export function CaseAgent() {
  return <Feature id="case-agent" eyebrow="The case agent" title={<>Every case, <br />followed through.</>} label="Case for Marcus Thompson, right knee ACL rehab: referral from Dr. Patel received Feb 26; authorization approved for 12 visits by UnitedHealthcare; visit 9 of 12, progress note signed Mar 12. Re-authorization is due after visit 12: the request is drafted with the progress note attached, ready to send to the payer."
    art={<div className="card case-card">
      <div className="case-head"><span className="chip-icon tone-sage big"><Icon name="sparkle" /></span><p>Case · <strong>Marcus Thompson</strong> · Right knee, ACL rehab.</p></div>
      <div className="case-row"><Check /><p>Referral from Dr. Patel · received Feb 26</p></div>
      <div className="case-row"><Check /><p>Authorization approved · 12 visits · UnitedHealthcare</p></div>
      <div className="case-row"><Check /><p>Visit 9 of 12 · progress note signed Mar 12</p></div>
      <div className="case-next"><span className="chip-icon tone-honey"><Icon name="doc" /></span><p>Re-authorization due after visit 12 · request drafted with progress note attached.</p></div>
      <p className="case-send">Send to payer<Arrow /></p>
    </div>}>
    Balm's case agent follows each referral from authorization to paid claim. It spots what stalled, cites the record and lines up the next step.
  </Feature>
}

/** A Jane import with every total checked. */
export function MovingIn() {
  return <Feature id="moving-in" flip eyebrow="Moving in" title={<>Bring your clinic <br />with you.</>} label="Import from Jane: 1,284 patients, 312 upcoming appointments, 9,406 signed notes and $18,240.55 in open balances, which match. 3 duplicate patients merged."
    art={<div className="card import-card">
      <div className="import-head"><span className="chip-icon tone-sage big"><Icon name="download" /></span><p>Import from Jane</p></div>
      <div className="import-row"><Check /><p>Patients · 1,284</p></div>
      <div className="import-row"><Check /><p>Upcoming appointments · 312</p></div>
      <div className="import-row"><Check /><p>Signed notes · 9,406</p></div>
      <div className="import-row"><Check /><p>Open balances · $18,240.55 · matches</p></div>
      <div className="import-merge"><span className="chip-icon tone-honey"><Icon name="copy" /></span><p>3 duplicate patients · merged.</p></div>
    </div>}>
    Import patients, appointments, notes and balances from WebPT, SimplePractice, Jane or Cliniko, and check every total before you switch.
  </Feature>
}
