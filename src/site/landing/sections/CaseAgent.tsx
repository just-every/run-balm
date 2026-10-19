import type { ReactNode } from 'react'
import { patient, therapist } from '../episode'
import { Avatar, Copy, Icon, Stage } from '../parts'

type Line = { icon: string; tone: 'sky' | 'sage' | 'lilac'; text: ReactNode; cite?: string; done?: true; avatar?: string }
const ITEMS: { date: string; title: ReactNode; lines: Line[] }[] = [
  { date: 'Apr 9', title: <>Claim #10511 denied · CO-4 modifier missing</>, lines: [
    { icon: 'doc', tone: 'sky', text: <>Note of Apr 2 shows 97140 manual therapy</>, cite: 'Daily note · Apr 2' },
    { icon: 'pencil', tone: 'sage', text: <>GP modifier added · sent Apr 9 · Maria G., billing</> },
    { icon: 'dollar', tone: 'sage', text: <>Paid $142.18 · ERA Apr 16</>, done: true },
  ] },
  { date: 'Apr 7', title: <>3 visits left on the authorization, 7 in the plan</>, lines: [
    { icon: 'doc', tone: 'sky', text: <>Re-auth drafted from progress note · flexion <span className="keep">0–118°</span>, LEFS 58/80</>, cite: 'Progress note · Apr 7' },
    { icon: 'user', tone: 'lilac', text: <>Progress note signed · {therapist}</>, avatar: 'SL' },
    { icon: 'send', tone: 'sage', text: <>Sent via Availity · Apr 7 · Maria G., billing</> },
    { icon: 'shieldCheck', tone: 'sage', text: <>Aetna approved 4 visits · Apr 13</>, done: true },
  ] },
  { date: 'Mar 24', title: <>$86.40 split in two · first $43.20 paid by text</>, lines: [
    { icon: 'doc', tone: 'sky', text: <>Deductible from the Mar 10 claim</>, cite: 'ERA · Mar 23' },
    { icon: 'dollar', tone: 'sage', text: <>Paid · card ending {patient.card}</>, done: true },
  ] },
]

/** 06: the case agent's log on Ana's case, newest first, every entry finished and citing the note it read; a biller
 * pressed Send on each (CONTRACT AGENT-004). */
export function CaseAgent() {
  return <Stage id="agent" ground="06">
    <Copy id="agent" eyebrow="The case agent" title={<>The case agent <br />keeps it moving.</>}>
      It reads every case and does the work: the corrected claim, the re‑authorization, the payment plan, each citing the note. Your biller just presses Send.
    </Copy>
    <article className="card agent-card">
      <header className="agent-head"><span className="chip-icon tone-sage"><Icon name="sparkle" /></span><h3 className="card-title">Case agent · {patient.name}</h3><p>3 items on this case</p></header>
      {ITEMS.map((item, i) => <section key={i} className="agent-item">
        <h4><span className="dot" aria-hidden="true" /><span className="agent-date">{item.date}</span><span className="agent-sep"> · </span>{item.title}</h4>
        <ul>{item.lines.map((line, j) => <li key={j}>
          <span className={`chip-icon tone-${line.tone}`}><Icon name={line.icon} /></span>
          <p><span>{line.text}</span>{line.cite && <span className="cite"><Icon name="form" />{line.cite}</span>}{line.avatar && <Avatar initials={line.avatar} tone="lilac" />}{line.done && <svg className="tick" viewBox="0 0 24 24" aria-label="done"><circle cx="12" cy="12" r="12" /><path d="m7.4 12.3 3.1 3.1 6.1-6.6" /></svg>}</p>
        </li>)}</ul>
      </section>)}
    </article>
  </Stage>
}
