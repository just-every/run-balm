// The pieces every section is made of. Text in the drawings is real text; the drawings
// are HTML and CSS (styles/cards.css and styles/sections/), never screenshots.
import type { ReactNode } from 'react'

/** One screen of the episode: its painted ground (a soft plate of window light, faded into its neighbours) under the
 * desk's 1536-wide frame, which carries `--u`, one desk pixel (styles/stage.css). */
export function Stage({ id, ground, children }: { id: string; ground?: string; children: ReactNode }) {
  return <section id={id} className={`stage stage-${id}`} aria-labelledby={`${id}-title`}>
    {ground && <Painting className="ground" name={`ground-${ground}`} widths={[768, 1536, 2304, 3072]} sizes="100vw" />}
    <div className="stage-frame"><div className="stage-body">{children}</div></div>
  </section>
}

/** A section's eyebrow, heading and paragraph. */
export function Copy({ id, eyebrow, title, children, className = '' }: { id: string; eyebrow: string; title: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`copy ${className}`.trim()}>
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={`${id}-title`}>{title}</h2>
    {children && <p className="copy-body">{children}</p>}
  </div>
}

/** A painted plate: AVIF, then WebP, at the sizes public/site holds; `phone` swaps in a crop on narrow screens. */
export function Painting({ name, widths, sizes, alt = '', className, phone, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; className?: string; phone?: { name: string; widths: number[]; media: string }; eager?: boolean }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  const fallback = widths.includes(1536) ? 1536 : Math.max(...widths)
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${fallback}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

/** The tinted round check badge the desk draws on finished steps. */
export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" /><path d="m7.4 12.3 3.1 3.1 6.1-6.6" /></svg>
export const Chevron = () => <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>

const PATHS: Record<string, ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M9.5 15.5l2 1.8 3.5-3.6" /></>,
  calendarPlain: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 16.5h5" /></>,
  docFill: <><path d="M6 2.5h8.5L19 7v14.5H6z" /><path d="M14.5 2.5V7H19M9.5 13h6M9.5 16.5h6" /></>,
  form: <><rect x="5.5" y="3.5" width="13" height="17" rx="2" /><path d="M9 8h6M9 11.5h6M9 15h4" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m8.6 10.5 3.4 4.2 3.4-4.2" /></>,
  shieldCheck: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m8.8 11.8 2.3 2.3 4.3-4.6" /></>,
  shieldPlain: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /></>,
  dollar: <><path d="M12 3v18M16.5 7.2C15.6 6 14 5.4 12.2 5.4c-2.6 0-4.4 1.3-4.4 3.3 0 4.6 9 2.4 9 6.9 0 2-2 3.4-4.7 3.4-2 0-3.7-.8-4.6-2.1" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  alert: <><path d="M12 3.5 2.8 19.5h18.4z" /><path d="M12 9.5v5M12 17.2v.3" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c.9-3.8 3.7-5.8 7.2-5.8s6.3 2 7.2 5.8" /></>,
  people: <><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5" /><circle cx="16.5" cy="9.5" r="2.6" /><path d="M15.8 14.2c2.4-.2 4.3 1.3 4.8 4.3" /></>,
  stethoscope: <><path d="M6 3.5v5a4 4 0 0 0 8 0v-5" /><path d="M10 12.5v2.5a4.5 4.5 0 0 0 9 0v-2" /><circle cx="19" cy="11" r="2" /></>,
  sparkle: <><path d="M12 3c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7z" /></>,
  sparkles: <><path d="M14 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" /><path d="M6.5 13.5c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" /></>,
  pencil: <><path d="m5 19 1-4.2L15.6 5.2a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L9.2 18 5 19z" /><path d="m13.8 7 3.2 3.2" /></>,
  send: <><path d="M20.5 3.5 3.5 10.6l7 2.9 2.9 7z" /><path d="m20.5 3.5-10 10" /></>,
  denied: <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  check: <><path d="m6 12.5 4 4 8-9" /></>,
  leaf: <><path d="M5.5 18.5C5 11 9.5 5.5 19 5c.4 9.5-5 14-12.5 13.5z" /><path d="M5.5 18.5 14 10" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>

/** A person in a drawing: a round initials avatar (never a photograph). */
export const Avatar = ({ initials, tone }: { initials: string; tone: 'sage' | 'sky' | 'honey' | 'mint' | 'lilac' }) => <span className={`avatar avatar-${tone}`} aria-hidden="true">{initials}</span>
