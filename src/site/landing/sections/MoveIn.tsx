import { Check, Copy, Icon, Stage } from '../parts'

const IMPORT = [['Patients', '1,284'], ['Upcoming appointments', '312'], ['Signed notes', '9,406'], ['Open balances', '$18,240.65 · totals match']]
const STEPS = ['git clone https://github.com/just-every/run-balm.git balm', 'cd balm', 'rer install', 'rer setup', 'rer dev']

/** 09: the short close, a Jane import with its totals, the five commands that run Balm at your clinic, and who it is
 * built for. */
export function MoveIn() {
  return <Stage id="move-in" ground="09">
    <div className="move-left">
      <Copy id="move-in" eyebrow="Moving in" title="Bring your clinic over.">
        Patients, appointments, notes and balances come across from WebPT, Jane, SimplePractice or Cliniko. Check every total before you switch.
      </Copy>
      <article className="card import-card">
        <h3 className="card-title">Import from Jane</h3>
        <dl>{IMPORT.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd><Check className="check" /></div>)}</dl>
        <p className="import-merged">3 duplicate patients · merged<Check className="check" /></p>
      </article>
    </div>
    <div className="move-right">
      <p className="eyebrow">Run it at your clinic</p>
      <div className="terminal" role="group" aria-label="Terminal">
        <p className="terminal-dots" aria-hidden="true"><span /><span /><span /></p>
        <pre><code>{STEPS.map(step => <span key={step} className="terminal-line"><b aria-hidden="true">$</b> {step.startsWith('git clone') ? <>git clone https://github.com/<wbr /><span className="keep">just-every/run-balm.git balm</span></> : step}</span>)}</code></pre>
      </div>
      <article className="card scope-card">
        <span className="chip-icon tone-sage"><Icon name="leaf" /></span>
        <div><h3 className="card-title">Built for outpatient therapy.</h3><p>PT, OT and speech clinics with 1 to 10 clinicians, billing Medicare, commercial payers and cash‑pay patients.</p></div>
      </article>
    </div>
  </Stage>
}
