import { clinic, patient, remittance } from '../episode'
import { Avatar, Check, Copy, Stage } from '../parts'

/** 07: Aetna's first ERA posting three claims on its own, the deductible on its own line, and the text Ana paid the
 * first half of it from on Mar 24. Phones drop the Billed column. */
export function Paid() {
  return <Stage id="paid" ground="07">
    <div className="paid-art">
      <article className="card era-card">
        <h3 className="card-title">{remittance.title[0]}<span className="tail-sep"> · </span><span className="tail">{remittance.title[1]}</span></h3>
        <table className="era-table">
          <thead><tr><th scope="col">Visit</th><th scope="col" className="billed">Billed</th><th scope="col">Paid</th><th scope="col">Patient</th></tr></thead>
          <tbody>{remittance.rows.map(row => [
            <tr key={row.visit}><th scope="row">{row.visit}</th><td className="billed">{row.billed}</td><td>{row.paid}</td><td>{row.patient}</td></tr>,
            row.note ? <tr key={`${row.visit}-note`} className="era-note"><td colSpan={4}><p>{row.note}</p></td></tr> : null,
          ])}</tbody>
        </table>
        <p className="era-foot"><Check className="check solid" /><span>Posted automatically · 3 of 3 matched</span></p>
      </article>
      <article className="phone-card" aria-label={`Text from ${clinic}`}>
        <span className="phone-notch" aria-hidden="true" />
        <header><Avatar initials="RP" tone="mint" /><p>{clinic}</p></header>
        <p className="bubble in">Hi {patient.first}, your balance is $86.40. First part today: $43.20.</p>
        <p className="phone-pay">Pay $43.20</p>
        <p className="phone-paid"><Check className="check solid" /><span>Paid · card ending {patient.card} · Mar 24</span></p>
      </article>
    </div>
    <Copy id="paid" eyebrow="Payments" title={<>Every visit, <br />paid.</>}>
      Payments post from the ERA. Copays are taken at check-in, and balances get paid from a text.
    </Copy>
  </Stage>
}
