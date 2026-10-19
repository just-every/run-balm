import { clinic, patient, physician } from '../episode'
import { Check, Copy, Icon, Stage } from '../parts'

/** 03: what lands before the first visit, the faxed referral, Aetna's eligibility and Ana's portal intake, joined by
 * dotted threads; the copy on the right. */
export function Ready() {
  return <Stage id="ready" ground="03">
    <div className="ready-art">
      <svg className="ready-threads" viewBox="0 0 960 940" aria-hidden="true"><path d="M478 118c40 4 56 40 66 112" /><path d="M800 390c38 12 52 60 56 120" /></svg>
      <article className="card ready-referral">
        <header className="ready-head"><span className="chip-icon tone-sky"><Icon name="doc" /></span><h3 className="card-title">Referral · Mar 3</h3></header>
        <ul className="ready-lines">
          <li><Icon name="user" /><p>{physician}<span className="tail-sep"> · </span><span className="tail">Riverside Orthopedics</span></p></li>
          <li><Icon name="form" /><p>PT evaluate and treat</p></li>
          <li><Icon name="stethoscope" /><p>{patient.complaint} · M25.561</p></li>
        </ul>
        <p className="soft-pill sky">Faxed in · filed to case</p>
      </article>
      <article className="card ready-eligibility">
        <header className="ready-head"><span className="chip-icon tone-sage"><Icon name="shieldCheck" /></span><h3 className="card-title">Eligibility<span className="tail-sep"> · </span><span className="tail">{patient.payer}</span></h3><p className="soft-pill green">Active</p></header>
        <dl className="ready-table">
          <div><dt>PT copay</dt><dd>$30</dd></div>
          <div><dt>Deductible left</dt><dd>$86.40</dd></div>
          <div><dt>Visits this year</dt><dd>0 of 30</dd></div>
        </dl>
        <p className="ready-auth"><Check className="check solid" /><span>Prior auth · 12 visits approved Mar 9</span></p>
      </article>
      <article className="card ready-welcome">
        <header className="ready-head"><span className="chip-icon tone-sky"><Icon name="docFill" /></span><div><p className="ready-from">{clinic}</p><h3 className="card-title">Welcome, {patient.first}</h3></div></header>
        <ul className="ready-checks">
          <li><Check className="check solid" /><p>Health history</p></li>
          <li><Check className="check solid" /><p>Consent to treat · signed Mar 6</p></li>
          <li><Check className="check solid" /><p>Insurance card · front and back</p></li>
          <li><Check className="check solid" /><p>Card on file · ending {patient.card}</p></li>
        </ul>
        <p className="ready-done">All done</p>
      </article>
    </div>
    <Copy id="ready" eyebrow="Before the first visit" title={<>Ready before <br />she arrives.</>}>
      The referral, insurance check and intake land in one case. {patient.first} fills in her forms from one link.
    </Copy>
  </Stage>
}
