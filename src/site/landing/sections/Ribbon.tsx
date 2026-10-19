import { milestones, patient, totals } from '../episode'
import { Check, Copy, Icon, Stage } from '../parts'

/** 02: the whole episode on one long case card, referral on Mar 3 to discharge on Apr 30, with the case agent credited
 * on the two steps it did. Phones read it as a vertical timeline. */
export function Ribbon() {
  return <Stage id="ribbon" ground="02">
    <Copy id="ribbon" className="centred" eyebrow="One patient, referral to discharge" title="From referral to paid.">
      Follow {patient.name}’s right knee through Balm: eight weeks, sixteen visits, one denial fixed.
    </Copy>
    <article className="card ribbon-card" aria-label={`Case: ${patient.name}`}>
      <header className="ribbon-head">
        <span className="avatar avatar-sky ribbon-avatar" aria-hidden="true">{patient.initials}</span>
        <h3 className="card-title">{patient.name}</h3>
        <p className="ribbon-meta"><span>·</span> {patient.complaint} <span>·</span> {patient.payer}</p>
        <p className="status-chip"><Check className="check solid" />Discharged · goals met</p>
      </header>
      <ol className="milestones">
        {milestones.map(m => <li key={m.date} className={`milestone ms-${m.tone}`}>
          <p className="milestone-date">{m.date}</p>
          <span className="milestone-dot" aria-hidden="true"><Icon name={m.icon} />{m.icon === 'denied' && <Check className="check solid fixed" />}</span>
          <p className="milestone-label">{m.label[0]}{m.label[1] && <> <br />{m.label[1]}</>}</p>
          {m.agent && <p className="agent-chip"><Icon name="sparkle" />case agent</p>}
        </li>)}
      </ol>
      <div className="visits-bar"><p>Visits</p><span aria-hidden="true"><i /></span><p>{totals.visits} of {totals.visits}</p></div>
      <dl className="ribbon-totals">
        <div className="t-notes"><dt>notes signed</dt><dd>{totals.notes}</dd></div>
        <div className="t-aetna"><dt>Aetna paid</dt><dd>{totals.aetnaPaid}</dd></div>
        <div className="t-ana"><dt>Ana paid</dt><dd>{totals.anaPaid}</dd></div>
        <div className="t-balance"><dt>Balance</dt><dd>{totals.balance}</dd></div>
      </dl>
    </article>
  </Stage>
}
