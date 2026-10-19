import { patient, physician, therapist } from '../episode'
import { Check, Copy, Icon, Stage } from '../parts'

/** 04: the initial evaluation the scribe drafted on Mar 10, signed by Sarah Lee, and Dr. Patel's plan-of-care
 * signature from the same note on Mar 11. */
export function Evaluation() {
  return <Stage id="evaluation" ground="04">
    <Copy id="evaluation" eyebrow="Evaluation" title={<>The scribe drafts. <br />You sign.</>}>
      Balm drafts the evaluation from the visit; you check it and sign. The plan of care goes to the physician from the same note.
    </Copy>
    <div className="eval-art">
      <article className="card eval-card">
        <header className="eval-head">
          <div><h3 className="card-title">Initial evaluation</h3><p className="eval-sub">{patient.name} · Mar 10 · 45 min</p></div>
          <p className="soft-pill green caps">PT</p>
        </header>
        <dl className="eval-rows">
          <div><dt>Diagnosis</dt><dd><span className="code">M25.561</span> Pain in right knee</dd></div>
          <div><dt>Findings</dt><dd>Knee flexion 0–95° · Quad strength 4-/5 · LEFS 38/80</dd></div>
          <div><dt>Goals</dt><dd><ul className="eval-goals"><li>Stairs without a rail</li><li>Knee flexion 0–130°</li><li>LEFS 70 or higher</li></ul></dd></div>
          <div><dt>Plan</dt><dd>2x a week · 8 weeks · 16 visits · home exercises</dd></div>
          <div><dt>Billed</dt><dd>97162 x1 · 97110 x1</dd></div>
        </dl>
        <footer className="eval-foot">
          <p><span className="chip-icon tone-honey"><Icon name="sparkles" /></span><span>Drafted by scribe from the visit</span></p>
          <p><Check className="check solid" /><span>Signed · {therapist} · Mar 10</span></p>
        </footer>
      </article>
      <aside className="card poc-card" aria-label="Plan of care signed">
        <Check className="check solid" />
        <div><h3 className="card-title">Plan of care signed</h3><p>{physician} · Mar 11</p></div>
        <svg className="signature" viewBox="0 0 220 64" aria-hidden="true"><path d="M8 50c10-16 18-36 22-40 3-3 6 2 3 8-4 8-14 14-20 14M30 30c4 0 6 3 4 7-1 4 2 5 5 1 2-3 4-9 6-9-2 6-3 10 0 9 3-1 4-6 6-8-1 4-4 16-8 22-3 4-7 2-4-3 5-8 13-16 18-18-2 4-4 9-1 8 3-1 5-6 7-8 1 3-1 9 3 7M86 48c8-14 14-34 18-38 3-3 6 2 2 8-4 6-12 10-16 10M102 32c4-1 7 2 5 6-1 3 1 4 4 1 2-2 3-6 5-6-1 4-2 7 1 6M118 34c3-12 6-20 8-24-2 10-4 18-3 22 1 3 4 1 6-2M126 22h8M136 32c2-2 5-3 6 0 1 3-4 6-2 8 2 1 5-3 7-6 2-6 6-18 7-24-2 10-4 20-2 24 2 3 8-2 14-6 18-10 40-10 54-12" /></svg>
      </aside>
    </div>
  </Stage>
}
