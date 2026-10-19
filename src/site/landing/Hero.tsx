import { Actions } from '../shell/Actions'
import { SiteHeader } from '../shell/SiteHeader'
import { HeroCards } from './HeroCards'
import { Painting } from './parts'

/** The sunlit therapy room, the promise and the action, with today's clinic in a column of cards on the right.
 * On wide screens everything sits at the desk's positions over the painting; on phones the cards stack and a crop of the room follows. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-canvas">
      <Painting className="hero-art" name="hero" widths={[768, 1152, 1536, 2304, 3072]} sizes="100vw" eager phone={{ name: 'hero-phone', widths: [640, 1000], media: '(max-width: 1099px)' }} />
      <SiteHeader overArt />
      <div className="hero-copy">
        <h1 id="hero-title">Back to your patients.</h1>
        <p className="hero-sub">Balm runs your clinic’s schedule, intake, notes and reminders, and bills insurance and patients through to paid.</p>
        <p className="hero-alt">100% free, open source alternative to <br /><strong>WebPT</strong>, <strong>SimplePractice</strong> and <strong>Jane</strong></p>
        <Actions />
      </div>
      <HeroCards />
    </div>
  </section>
}
