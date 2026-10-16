import { Check, Painting } from '../parts'

/** The one painted band between the stories: a home exercise corner in the afternoon sun, the day's notes done. */
export function Interlude() {
  return <section className="interlude" aria-label="All 14 notes signed, claims sent">
    <p className="interlude-badge"><Check className="check solid" />All 14 notes signed · claims sent</p>
    <Painting className="interlude-art" name="interlude" widths={[768, 1152, 1536]} sizes="100vw" />
  </section>
}
