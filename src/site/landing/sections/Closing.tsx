import { Actions } from '../../shell/Actions'
import { SiteFooter } from '../../shell/SiteFooter'
import { Painting } from '../parts'

/** The closing promise over the clinic's front at golden hour, then the footer. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="closing-canvas">
      <Painting className="closing-art" name="closing" widths={[768, 1152, 1536]} sizes="100vw" phone={{ name: 'closing-phone', widths: [640, 976], media: '(max-width: 1099px)' }} />
      <div className="closing-copy">
        <h2 id="closing-title">Leave on time, every note signed.</h2>
        <p className="closing-sub">Open source practice management for US therapy clinics.</p>
        <Actions demo={false} />
        <p className="closing-small">Free and open source, MIT licensed.</p>
      </div>
    </div>
    <SiteFooter />
  </section>
}
