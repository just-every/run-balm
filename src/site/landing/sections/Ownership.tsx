import { links } from '../../shell/links'
import { Icon } from '../parts'

const REPO = 'just-every/run-balm'
const COMMAND = `npx -y @runeditrun/rer dev ${REPO}`
const COMMENT = '# clones, installs and starts Balm on your computer'

/** Balm on your own computer: the one command that clones, sets up and starts it, in a terminal, with a resistance band resting on its corner. */
export function Ownership() {
  return <section className="ownership" aria-labelledby="ownership-title">
    <div className="feature-copy">
      <p className="eyebrow">Ownership</p>
      <h2 id="ownership-title">Your clinic, <br />your records.</h2>
      <p className="feature-body"><a href={links.run}>Run Balm</a> on your own computer and <br />keep every chart. Export everything, any time.</p>
      <ul className="own-list">
        <li><span className="own-icon tone-sage"><Icon name="laptop" /></span>Your own computer</li>
        <li><span className="own-icon tone-honey"><Icon name="database" /></span>Your charts, your database</li>
        <li><span className="own-icon tone-sky"><Icon name="upload" /></span>Export any time</li>
      </ul>
    </div>
    <div className="terminal-wrap">
      <div className="terminal" role="img" aria-label={`Terminal: ${COMMAND}. ${COMMENT}`}>
        <p className="terminal-dots" aria-hidden="true"><span /><span /><span /></p>
        <pre aria-hidden="true"><code><span><b>$</b> npx -y @runeditrun/rer dev <span style={{ whiteSpace: 'nowrap' }}>{REPO}</span>{'\n'}</span><span>{COMMENT}{'\n'}</span></code></pre>
      </div>
      <svg className="band" viewBox="0 0 305 345" aria-hidden="true">
        <defs><linearGradient id="band-face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7fae80" /><stop offset=".55" stopColor="#5f9566" /><stop offset="1" stopColor="#3f744b" /></linearGradient></defs>
        <path className="band-back" d="M10 56C42 22 84 8 116 18c56 18 98 96 132 172 22 50 50 98 42 130-8 28-44 26-58-4-22-48-36-96-62-140-30-50-60-90-100-104-24-8-44-10-60-16z" />
        <path className="band-front" d="M10 50C42 16 84 2 116 12c56 18 98 96 132 172 22 50 50 98 42 130-8 28-44 26-58-4-22-48-36-96-62-140-30-50-60-90-100-104-24-8-44-10-60-16z" />
        <path className="band-shine" d="M60 22c30-10 50-8 70 2 40 22 74 88 100 150" />
      </svg>
    </div>
  </section>
}
