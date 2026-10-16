import { Icon } from '../parts'

const DETAILS: { icon: string; tone: 'sage' | 'honey' | 'sky'; title: string; body: string }[] = [
  { icon: 'video', tone: 'sage', title: 'Telehealth', body: 'Video visits from the same calendar.' },
  { icon: 'run', tone: 'honey', title: 'Home exercise programs', body: 'Videos and sets patients follow at home.' },
  { icon: 'chat', tone: 'sky', title: 'Secure messaging', body: 'Patients write in the portal, not your inbox.' },
  { icon: 'bars', tone: 'sky', title: 'Therapy cap tracking', body: 'KX threshold flagged before a visit crosses it.' },
  { icon: 'sign', tone: 'sage', title: 'Plan of care signatures', body: 'Physicians sign online; Balm tracks the date.' },
  { icon: 'shieldPlain', tone: 'honey', title: 'Audit log', body: 'Every chart view and change, recorded.' },
]

/** Six smaller things, three across. */
export function Details() {
  return <section className="details" aria-labelledby="details-title">
    <p className="eyebrow">Also included</p>
    <h2 id="details-title">The quiet details.</h2>
    <ul className="details-grid">
      {DETAILS.map(({ icon, tone, title, body }) => <li key={title} className="card detail-card"><span className={`chip-icon tone-${tone} huge`}><Icon name={icon} /></span><h3>{title}</h3><p>{body}</p></li>)}
    </ul>
  </section>
}
