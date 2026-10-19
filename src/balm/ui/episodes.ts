// REF-003 on the client file: episodes with their visits, authorization use, plans
// and outcomes kept apart, opening and closing, and filing records to an episode.
import { desk, empty, entry, field, form, h, hidden, owner, panel, select, stamp, status } from './shared'

const open = (f: any) => (f.episodes ?? []).filter((e: any) => e.status === 'open')
const named = (f: any, id: string) => (f.episodes ?? []).find((e: any) => e.id === id)?.title ?? 'Not assigned to an episode'

/** The episode picker for a new record: preselected with one open episode, a required choice with several. */
export function episodeField(f: any, label = 'Episode of care') {
  const list = open(f)
  if (!list.length) return ''
  return select('episodeId', label, [...(list.length > 1 ? [['', 'Choose an episode']] : []), ...list.map((e: any) => [e.id, e.title])] as [unknown, unknown][], list.length === 1 ? list[0].id : '')
}

/** File one existing record to an open episode. */
export function assignForm(f: any, kind: string, recordId: string, current: string, path: string) {
  const choices = open(f).filter((e: any) => e.id !== current)
  if (!choices.length) return ''
  return `<details><summary>${current ? 'Move to another episode' : 'Assign to an episode'}</summary>${form('episode.assign', path, hidden('kind', kind) + hidden('recordId', recordId)
    + select('episodeId', 'Episode of care', choices.map((e: any) => [e.id, e.title])), 'Assign')}</details>`
}

export const episodeLabel = (f: any, id: string) => (f.episodes ?? []).length > 1 || id ? `<span class="help">Episode: ${h(named(f, id))}</span>` : ''

export function episodesPanel(s: any, f: any) {
  if (!f.episodes) return ''
  const path = `/app/clients/${f.client.id}`, list = f.episodes.filter((e: any) => e.id || e.visits.total || e.plans || e.authorizations?.length || e.measures?.length)
  const body = list.map((e: any) => entry(e.title, `<p>${e.status === 'not_assigned' ? status('Not assigned') : status(e.status === 'open' ? 'Open' : 'Closed')}`
    + (e.openedAt ? ` · opened ${stamp(s, e.openedAt)} by ${h(e.openedBy)}` : '') + (e.closedAt ? ` · closed ${stamp(s, e.closedAt)} by ${h(e.closedBy)}${e.closeReason ? `: ${h(e.closeReason)}` : ''}` : '') + '</p>'
    + `<p data-episode-visits="${h(e.id)}">Visits: ${h(e.visits.attended)} attended · ${h(e.visits.booked)} booked · ${h(e.visits.cancelled)} canceled · ${h(e.visits.noShows)} no-show · plans of care: ${h(e.plans)}</p>`
    + (e.authorizations?.length ? `<ul class="plain">${e.authorizations.map((a: any) => `<li data-authorization="${h(a.id)}">Authorization ${h(a.number)}: ${h(a.used)} used, ${h(a.reserved)} booked, ${h(a.remaining)} of ${h(a.visits)} left</li>`).join('')}</ul>` : '')
    + (e.measures?.length ? `<ul class="plain">${e.measures.map((m: any) => `<li data-measure="${h(m.key)}">${h(m.name)}${m.side !== 'none' ? ` (${h(m.side)})` : ''}: ${h(m.baseline)} → ${h(m.latest)} ${h(m.unit)} (${m.change > 0 ? '+' : ''}${h(m.change)})</li>`).join('')}</ul>` : '')
    + (e.status === 'open' && (desk(s) || s.actor.staffId) ? `<details><summary>Close this episode</summary><p>Closing (discharge) keeps every record in it, signed notes and plans unchanged; a closed episode takes no new records. Cancel or move its booked visits first.</p>${form('episode.close', path, hidden('id', e.id) + field('reason', 'Reason (optional)', '', 'text', 'maxlength="300"'), 'Close episode', true)}</details>` : ''),
  `episode-${e.id || 'none'}`)).join('')
  const waiting = (f.referrals ?? []).filter((r: any) => !r.episode_id && !r.lost_at)
  const starts = [...waiting.map((r: any) => [r.id, `Referral from ${`${r.referring_first} ${r.referring_last}`.trim() || 'a referring provider'} (received ${r.received_on})`]), ['direct_access', 'Direct access (no referral)']] as [unknown, unknown][]
  const opening = desk(s) || owner(s) || s.actor.staffId ? `<details><summary>Open an episode</summary>${form('episode.open', path, hidden('clientId', f.client.id) + field('title', 'Episode title', '', 'text', 'required maxlength="120" placeholder="Left knee"')
    + select('start', 'Starts from', starts, waiting.length ? waiting[0].id : 'direct_access'), 'Open episode')}</details>` : ''
  const referrals = (f.referrals ?? []).length ? `<h3>Referrals</h3><ul class="plain">${f.referrals.map((r: any) => `<li data-referral="${h(r.id)}">${r.kind === 'direct_access' ? 'Direct access' : `From ${h(`${r.referring_first} ${r.referring_last}`.trim())}${r.referring_npi ? ` · NPI ${h(r.referring_npi)} ${r.npi_source === 'nppes' ? '(NPPES)' : '(entered, not checked)'}` : ''}`} · received ${h(r.received_on)} · ${status(r.stage)}${r.episode_id ? ` · ${h(named(f, r.episode_id))}` : ''}</li>`).join('')}</ul>` : ''
  return panel('Episodes of care', '<p>Each episode starts from a referral or direct access and keeps its own visits, plan of care, authorizations and outcomes. New records join the only open episode; with several open, choose one. Records from before episodes stay not assigned until someone assigns them; Balm never guesses from dates.</p>'
    + (body || empty('No episodes yet.')) + referrals + opening, 'full', 'episodes')
}
