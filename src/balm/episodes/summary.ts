// REF-003 on the client file: each episode's visits, authorization use, plans and
// outcome measures, built only from the records this reader already reaches.
import { changesAt, measureSeries } from '../charting/measures'
import { NOT_ASSIGNED } from './index'

/** CHART-005 series, evaluation baselines and graphs split by episode. Series outside an
 * episode keep their CHART-005 key; an episode's series key starts with its episode id. */
export function seriesByEpisode(notes: any[]) {
  const groups = new Map<string, any[]>()
  for (const n of notes) groups.set(n.episodeId, [...groups.get(n.episodeId) ?? [], n])
  return [...groups].flatMap(([episodeId, list]) => measureSeries(list).map(s => ({ ...s, episodeId, key: episodeId ? episodeId + '|' + s.key : s.key })))
}
export const changesInEpisode = (series: any[], note: any) => changesAt(series.filter(s => s.episodeId === note.episodeId), note)

export function episodeSummaries(index: { episodes: any[] }, f: { appointments: any[]; plans: any[]; authorizations: any[] | null; measures: any[] | null }) {
  const buckets = [...index.episodes.map(e => ({ id: e.id as string, title: e.title as string, status: e.closed_at ? 'closed' : 'open', openedAt: e.opened_at, openedBy: e.opened_by, closedAt: e.closed_at, closedBy: e.closed_by, closeReason: e.close_reason })),
    { ...NOT_ASSIGNED, status: 'not_assigned' }]
  return buckets.map(e => {
    const visits = f.appointments.filter(a => a.episodeId === e.id)
    const count = (status: string) => visits.filter(a => a.status === status).length
    return { ...e,
      visits: { total: visits.length, booked: count('booked'), attended: count('attended'), cancelled: count('cancelled'), noShows: count('no_show') },
      plans: f.plans.filter(p => p.episodeId === e.id).length,
      authorizations: f.authorizations?.filter(a => a.episodeId === e.id).map(a => ({ id: a.id, number: a.number, visits: a.allowance_total, kind: a.allowance_kind, used: a.used_allowance, reserved: a.reserved_allowance, remaining: a.remaining_allowance })) ?? null,
      measures: f.measures?.filter(s => s.episodeId === e.id).map(s => ({ key: s.key, kind: s.kind, name: s.name, side: s.side, unit: s.unit, baseline: s.baseline.value, latest: s.latest.value, change: s.change, points: s.points.length })) ?? null }
  })
}
