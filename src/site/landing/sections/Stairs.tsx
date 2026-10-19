import { patient } from '../episode'
import { Check, Copy, Painting, Stage } from '../parts'

/** 08: discharge on Apr 30, the practice staircase she now climbs without a rail, and her discharge summary. */
export function Stairs() {
  return <Stage id="stairs" ground="08">
    <Copy id="stairs" eyebrow="Discharge" title={<>Back on <br />the stairs.</>}>Discharged Apr 30 with every goal met.</Copy>
    <Painting className="stairs-art" name="stairs" widths={[640, 969, 1292, 1938]} sizes="(min-width: 1100px) 63vw, 100vw" />
    <article className="card discharge-card">
      <h3 className="card-title">Discharge summary<span className="ds-sep"> · </span><span className="ds-meta">{patient.name} · Apr 30</span></h3>
      <dl>
        <div><dt>Knee flexion</dt><dd><span className="keep">0–95°</span> → <span className="keep">0–134°</span></dd></div>
        <div><dt>LEFS</dt><dd>38 → 74 / 80</dd></div>
        <div><dt>Stairs without a rail</dt><dd><Check className="check" /></dd></div>
        <div><dt>Goals met</dt><dd>3 of 3<Check className="check" /></dd></div>
      </dl>
      <p className="discharge-foot">Home program continues in her portal</p>
    </article>
  </Stage>
}
