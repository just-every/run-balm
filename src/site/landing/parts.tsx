// The pieces every section is made of. Text in the drawings is real text; the drawings
// are HTML and CSS (styles/cards.css), never screenshots.
import type { ReactNode } from 'react'

/** One idea per section: eyebrow, heading and a short paragraph beside its drawing; `flip` puts the drawing first. */
export function Feature({ id, eyebrow, title, children, art, flip = false, label, extra }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode; art: ReactNode; flip?: boolean; label: string; extra?: ReactNode }) {
  return <section id={id} className={`feature feature-${id}${flip ? ' flip' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="feature-copy"><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2><p className="feature-body">{children}</p>{extra}</div>
    <div className="feature-art" role="img" aria-label={label}><div aria-hidden="true" className="feature-drawing">{art}</div></div>
  </section>
}

/** A desk page's worth of sections at the desk's proportions (styles/landing.css). */
export const Spread = ({ name, children }: { name: string; children: ReactNode }) => <div className={`spread spread-${name}`}><div className="spread-inner">{children}</div></div>

/** A painted plate: AVIF, then WebP, at the sizes public/site holds; `phone` swaps in a crop on narrow screens. */
export function Painting({ name, widths, sizes, alt = '', className, phone, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; className?: string; phone?: { name: string; widths: number[]; media: string }; eager?: boolean }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  const largest = Math.max(...widths)
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${largest}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

/** The tinted round check badge the desk draws on finished steps. */
export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.4 12.3 3.1 3.1 6.1-6.6" /></svg>
export const Chevron = () => <svg className="chevron" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
export const ArrowRight = () => <svg className="arrow-r" viewBox="0 0 20 12"><path d="M1 6h17M13 1.5 18 6l-5 4.5" /></svg>

const PATHS: Record<string, ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M9.5 15.5l2 1.8 3.5-3.6" /></>,
  calendarPlain: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 16.5h5" /></>,
  docFill: <><path d="M6 2.5h8.5L19 7v14.5H6z" /><path d="M14.5 2.5V7H19M9.5 13h6M9.5 16.5h6" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m8.6 10.5 3.4 4.2 3.4-4.2" /></>,
  dollar: <><path d="M12 3v18M16.5 7.2C15.6 6 14 5.4 12.2 5.4c-2.6 0-4.4 1.3-4.4 3.3 0 4.6 9 2.4 9 6.9 0 2-2 3.4-4.7 3.4-2 0-3.7-.8-4.6-2.1" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  alert: <><path d="M12 3.5 2.8 19.5h18.4z" /><path d="M12 9.5v5M12 17.2v.3" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c.9-3.8 3.7-5.8 7.2-5.8s6.3 2 7.2 5.8" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  dumbbell: <><path d="M3.5 9.5v5M6.5 7.5v9M17.5 7.5v9M20.5 9.5v5M6.5 12h11" /></>,
  sparkle: <><path d="M14 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" /><path d="M6.5 13.5c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" /></>,
  download: <><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 14.5v5h15v-5" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  laptop: <><rect x="5" y="5.5" width="14" height="9.5" rx="1.3" /><path d="M2.8 18.5h18.4" /></>,
  database: <><ellipse cx="12" cy="6" rx="6.8" ry="2.7" /><path d="M5.2 6v12c0 1.5 3 2.7 6.8 2.7s6.8-1.2 6.8-2.7V6M5.2 12c0 1.5 3 2.7 6.8 2.7s6.8-1.2 6.8-2.7" /></>,
  upload: <><path d="M12 15V3.8M7.5 8.2 12 3.8l4.5 4.4" /><path d="M4.5 13.5v6h15v-6" /></>,
  video: <><rect x="2.8" y="6.5" width="13" height="11" rx="2.2" /><path d="m15.8 10.5 5.4-3v9l-5.4-3" /></>,
  run: <><circle cx="14.5" cy="4.3" r="1.8" /><path d="m9 21 2.5-6 3 2.4V21M7 11.5l3-3.3 4.2.3 1.8 3.3 3 .7M11.5 15l1.3-5.8M4.5 20h3.2" /></>,
  chat: <><path d="M12 4c4.8 0 8.5 3.1 8.5 7s-3.7 7-8.5 7c-1 0-2-.1-2.9-.4L4.5 20l1.2-3.9C4.3 14.8 3.5 13 3.5 11c0-3.9 3.7-7 8.5-7z" /><path d="M8.5 11.2v.1M12 11.2v.1M15.5 11.2v.1" /></>,
  bars: <><path d="M6.5 19v-5M12 19V9.5M17.5 19V5" /></>,
  sign: <><path d="M6 2.5h8.5L19 7v6M6 2.5v19h7" /><path d="M14.5 2.5V7H19M9.5 12h6M9.5 15.5h3.5" /><path d="m14.5 19 2 2 4-4.2" /></>,
  shieldPlain: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /></>,
  play: <><path d="M9 6.5v11l9-5.5z" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>

/** A person in a drawing: a round initials avatar (never a photograph). */
export const Avatar = ({ initials, tone }: { initials: string; tone: 'sage' | 'sky' | 'honey' | 'mint' }) => <span className={`avatar avatar-${tone}`}>{initials}</span>
