// HIPAA-004 screens. The Clinic page's Backups panel is the owner's whole setup: the storage they control,
// the public key they generated (Balm never sees the private half), a back-up-now button and the run
// history. The recovery point (the moment the newest backup's snapshot was taken) also leads the owner's
// schedule, the page they open first.
import { check, field, form, h, panel, select, stamp, status, textarea } from './shared'

const size = (bytes: unknown) => { const n = Number(bytes ?? 0); return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB' }
const many = (n: unknown, one: string, plural = one + 's') => `${Number(n ?? 0)} ${Number(n ?? 0) === 1 ? one : plural}`
const counts = (c: any) => c ? [many(c.clients, 'client'), many(c.visits, 'visit'), many(c.notes, 'note'), many(c.invoices, 'invoice'), many(c.audit, 'audit entry', 'audit entries')].join(', ') : ''
const HOUR = 3_600_000

/** 'ok' when the newest backup is within twice the chosen interval and the latest attempt did not fail; otherwise why not. */
export function recoveryState(b: any, at = Date.now()) {
  if (!b?.saved) return { tone: 'none', label: 'Not backed up' }
  if (!b.recovery) return { tone: b.saved.enabled ? 'waiting' : 'paused', label: b.saved.enabled ? 'First backup pending' : 'Paused' }
  const age = at - Date.parse(b.recovery.recovery_point)
  if (!b.saved.enabled) return { tone: 'paused', label: 'Paused' }
  if (b.runs[0]?.state === 'failed') return { tone: 'failing', label: 'Last attempt failed' }
  return age > 2 * b.saved.interval_hours * HOUR ? { tone: 'late', label: 'Backup overdue' } : { tone: 'ok', label: 'Backed up' }
}

function point(s: any, b: any) {
  const r = b.recovery
  return r ? `<strong>Recovery point ${stamp(s, r.recovery_point)}</strong> · ${h(size(r.bytes))} encrypted · ${h(counts(r.counts))}` : 'No backup has completed yet.'
}

/** A line above the owner's schedule: the newest recovery point, or the one thing wrong with backups. */
export function recoveryStrip(s: any) {
  const b = s.backups
  if (!b || b.managed || s.actor.role !== 'owner') return ''
  const state = recoveryState(b), last = b.runs[0]
  if (state.tone === 'none') return '<div class="notice" role="status" data-recovery-point="none">Your clinic is not backed up automatically. <a href="/app/clinic#backups">Set up backups</a></div>'
  const failing = state.tone === 'failing'
  return `<div class="notice${state.tone === 'late' || failing ? ' error' : ''}" role="${failing ? 'alert' : 'status'}" data-recovery-point="${h(state.tone)}">${status(state.label)} ${point(s, b)}${failing ? ` · ${h(last.error)}` : ''} <a href="/app/clinic#backups">Backups</a></div>`
}

function runsTable(s: any, b: any) {
  if (!b.runs.length) return ''
  return `<details><summary>Backup history</summary><div class="table"><table><thead><tr><th>Started</th><th>Result</th><th>Recovery point</th><th>Object</th></tr></thead><tbody>${b.runs.map((r: any) => `<tr><td>${stamp(s, r.started_at)}<br><span class="help">${r.trigger === 'manual' ? 'Back up now' : 'Automatic'}</span></td><td>${status(r.state === 'ok' ? 'Backed up' : r.state === 'running' ? 'Running' : 'Failed')}${r.error ? `<br>${h(r.error)}` : ''}</td><td>${r.recovery_point ? stamp(s, r.recovery_point) + `<br><span class="help">${h(size(r.bytes))}</span>` : '—'}</td><td>${r.object_key ? `<code>${h(r.object_key)}</code>` : '—'}</td></tr>`).join('')}</tbody></table></div></details>`
}

const steps = '<ol class="steps">'
  + '<li><strong>Make a key pair on your own computer.</strong> In the folder you run Balm from, run <code>rer run backup:keygen</code>. It saves <code>exports/balm-backup-private-key.pem</code> (readable only by you) and prints a public key. Keep the private key somewhere safe and separate from this clinic: Balm never sees it, so nobody (not Balm, not your hosting, not your storage) can read a backup without it, and a lost key cannot be recovered.</li>'
  + '<li><strong>Choose storage you control.</strong> Any S3-compatible bucket: Amazon S3 (<code>https://s3.us-east-1.amazonaws.com</code>), Cloudflare R2 (<code>https://ACCOUNT.r2.cloudflarestorage.com</code>, region <code>auto</code>), MinIO or a NAS in your office. Create a bucket and an access key that can only write and list that bucket. Use storage covered by a HIPAA business associate agreement with your practice.</li>'
  + '<li><strong>Paste both below and save.</strong> Balm writes one small check file to prove the access key works, then backs up on the schedule you choose. Each backup is a new object; Balm never deletes or overwrites one, so set the bucket’s own rules for how long they are kept.</li>'
  + '</ol>'

const drill = '<details><summary>Restore drill: prove a backup restores, somewhere else</summary><p>On your own computer (not the hosted clinic), in a Balm folder with your storage settings in a private file (see docs/backup.md):</p>'
  + '<pre>rer run backup:drill -- --key exports/balm-backup-private-key.pem --env-file backup.env</pre>'
  + '<p class="help">The drill downloads your newest backup, decrypts it with your private key, restores it into a scratch copy of Balm that it deletes afterwards, and prints the recovery point and what it found. To restore for real, use <code>rer run backup:restore</code> and then <code>rer import</code> into a fresh Balm, as <code>docs/backup.md</code> explains.</p></details>'

export function backupsPanel(s: any, notice: any) {
  const b = s.backups
  if (!b) return ''
  if (b.managed) return panel('Backups', `<p>${status('Not available yet')} ${h(b.line)}</p>`, 'full', 'backups')
  const v = b.saved, state = recoveryState(b)
  const head = `<p>${status(state.label)} ${point(s, b)}</p>` + (v ? `<p class="help">Encrypted to key <code>${h(v.key_fingerprint)}</code> · every ${h(v.interval_hours)} hours · bucket ${h(v.bucket)} · saved by ${h(v.updated_by)}, ${stamp(s, v.updated_at)}${v.checked_at ? ` · connection ${v.check_ok ? 'checked' : 'check failed'} ${stamp(s, v.checked_at)}${v.check_ok ? '' : ': ' + h(v.check_message)}` : ''}</p>` : '')
  const settings = form('backup.save', '/app/clinic',
    field('endpoint', 'Storage address', v?.endpoint ?? '', 'url', 'required maxlength="300" placeholder="https://s3.us-east-1.amazonaws.com"')
    + `<div class="pair">${field('bucket', 'Bucket', v?.bucket ?? '', 'text', 'required maxlength="63"')}${field('region', 'Region', v?.region ?? '', 'text', 'required maxlength="40" placeholder="us-east-1 (R2: auto)"')}</div>`
    + field('prefix', 'Folder in the bucket (optional)', v?.prefix ?? '', 'text', 'maxlength="200" placeholder="balm"')
    + `<div class="pair">${field('accessKeyId', 'Access key ID', v?.access_key_id ?? '', 'text', 'required maxlength="200" autocomplete="off"')}${field('secretAccessKey', v ? 'Secret access key (leave blank to keep the saved one)' : 'Secret access key', '', 'password', `${v ? '' : 'required '}maxlength="400" autocomplete="off"`)}</div>`
    + textarea('publicKey', v ? 'Public key (leave blank to keep the saved one)' : 'Public key from backup:keygen', '', `${v ? '' : 'required '}rows="3" maxlength="2000" spellcheck="false" placeholder="balm-backup-public-v1:…"`)
    + select('intervalHours', 'Back up every', [[1, 'hour'], [6, '6 hours'], [12, '12 hours'], [24, 'day']], v?.interval_hours ?? 24)
    + check('consent', 'I understand each backup holds every patient record, is encrypted so that only my private key opens it, and that I am responsible for keeping that key and this storage safe.', v ? '' : 'required')
    + (v ? `<p class="help">Consent recorded by ${h(v.consent_by)}, ${stamp(s, v.consent_at)}.</p>` : ''), v ? 'Save backup settings' : 'Turn on automatic backups')
  const controls = v ? form('backup.run', '/app/clinic', '', 'Back up now') + form(v.enabled ? 'backup.pause' : 'backup.resume', '/app/clinic', '', v.enabled ? 'Pause backups' : 'Resume backups', true) + form('backup.remove', '/app/clinic', '', 'Remove storage settings', true) : ''
  return panel('Backups', head + `<p>Balm backs the whole clinic up automatically to storage you control, encrypted before it leaves, so you can restore it somewhere else if this deployment is lost.</p>` + (v ? '' : steps) + `<details${v ? '' : ' open'}><summary>${v ? 'Storage, key and schedule' : 'Set up'}</summary>${settings}</details>${controls}${runsTable(s, b)}${drill}`, 'full', 'backups')
}
