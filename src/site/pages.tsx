// The run site (run-balm.com) `rer build --site` writes: the homepage with its Run action, /run, the docs from
// docs/*.md, and the not-found page. Every Run page string and command is in run.json; nothing here reads
// installation data.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import type { EditionIdentity } from '../base/identity'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsHead, docsPages } from './docs/pages'
import { Landing } from './landing/Landing'
import run from './run.json'

// Code cards get their Copy button only when script runs; without it the command is still there to select.
const COPY = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

/** Names and short phrases on the homepage that never break inside themselves. */
const HELD = /\b(?:Ana Ramirez|Sarah Lee|Dr\. Priya Patel|Priya Patel|Dr\. Patel|David Moore|Maria G\.|Physical Therapy|Riverside Orthopedics|Aetna PPO|Sent via Availity|card ending \d+|\d+ in the plan|paid by text|LEFS \d+\/\d+|\d+ visits)(?!\w)/g

/** The homepage's " · " and " → " hold to the words on both sides, so no line starts or ends with one, and a date
 * ("Mar 9"), a duration ("4 min"), a name or a value never splits across lines. */
const keepSeparators = (html: string) => html.replaceAll(' · ', '\u00a0·\u00a0').replaceAll(' → ', '\u00a0→\u00a0')
  .replace(/\b(Mar|Apr) (\d)/g, '$1\u00a0$2').replace(/(\d) min\b/g, '$1\u00a0min')
  .replace(HELD, phrase => phrase.replaceAll(' ', '\u00a0'))

/** The run site's own theme (public/site/theme.css: its tokens, faces and page font), for Base's Run and not-found
 * pages; no floor art there, and not the app's look in /fonts/fonts.css. */
const siteIdentity: EditionIdentity = { ...identity, theme: '/site/theme.css', band: undefined, fonts: undefined }
const SHARE_IMAGE = `${identity.runSite}/site/share.jpg`
const HOME_DESCRIPTION = 'Balm runs your clinic’s schedule, intake, notes and reminders, and bills insurance and patients through to paid. 100% free, open source alternative to WebPT, SimplePractice and Jane.'

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  const data: RunData = run
  const document = (title: string, description: string, body: ReactElement, script = '') => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en-US">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#faf7f2" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Balm" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={SHARE_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preload" href="/fonts/newsreader/newsreader-latin-standard-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href={siteIdentity.theme} />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}{script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}</body>
    </html>,
  )
  const head = (slug?: string) => { const { title, description } = docsHead(slug); return [title, description] as const }
  return {
    pages: [
      { path: '/', html: keepSeparators(document('Balm — Back to your patients', HOME_DESCRIPTION, <Landing />)) },
      { path: '/run', html: runPageHtml(siteIdentity, data, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(siteIdentity, data, contract) }] : []),
      { path: '/docs', html: document(...head(), <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(...head(page.slug), <DocsArticle slug={page.slug} />, COPY) })),
      { path: '/404', html: siteNotFoundHtml(siteIdentity, data, contract) },
    ],
    assets: ['fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
