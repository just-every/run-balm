// CHART-005 objective measures. Each kind has fixed units and bounds; manual muscle
// test grades are stored in quarter steps (4- = 3.75, 4 = 4, 4+ = 4.25) and shown as
// grades. Values keep at most two decimals as entered.
export type MeasureKind = 'rom' | 'mmt' | 'girth' | 'balance' | 'gait' | 'score' | 'flowsheet'
export const measureKinds: Record<MeasureKind, { label: string; units: string[]; min: number; max: number }> = {
  rom: { label: 'Range of motion', units: ['degrees'], min: -180, max: 360 },
  mmt: { label: 'Manual muscle test', units: ['grade'], min: 0, max: 5 },
  girth: { label: 'Girth', units: ['cm', 'in'], min: 0, max: 300 },
  balance: { label: 'Balance test', units: ['seconds', 'points'], min: 0, max: 10000 },
  gait: { label: 'Gait test', units: ['m/s', 'seconds', 'meters', 'feet'], min: 0, max: 10000 },
  score: { label: 'Standardized score', units: ['points', 'percent'], min: 0, max: 1000 },
  flowsheet: { label: 'Exercise flowsheet', units: ['lb', 'kg', 'bodyweight'], min: 0, max: 2000 },
}
export const sides = ['none', 'left', 'right', 'both'] as const

const GRADE = /^([0-5])([+-]?)$/
/** An MMT grade such as 3+ to its stored value; null when it is not a grade. 0- and 5+ do not exist. */
export function gradeValue(grade: string) {
  const m = GRADE.exec(grade.trim())
  if (!m || (m[1] === '0' && m[2] === '-') || (m[1] === '5' && m[2] === '+')) return null
  return Number(m[1]) + (m[2] === '+' ? 0.25 : m[2] === '-' ? -0.25 : 0)
}
export function gradeLabel(value: number) {
  const base = Math.round(value), rest = value - base
  return `${base}${rest > 0 ? '+' : rest < 0 ? '-' : ''}`
}
export const shown = (kind: string, value: number) => kind === 'mmt' ? gradeLabel(value) : String(value)

type Point = { noteId: string; at: string; value: number; evaluation: boolean }
export type Series = { key: string; kind: string; name: string; side: string; unit: string; points: Point[]; baseline: Point; latest: Point; change: number }
const round = (n: number) => Math.round(n * 100) / 100

/** Series by kind, name (case-insensitive), side and unit, in visit order. The baseline is the
 * earliest entry recorded in an evaluation note, or the first entry when no evaluation recorded it. */
export function measureSeries(notes: any[]): Series[] {
  const map = new Map<string, Series>()
  const ordered = [...notes].sort((a, b) => a.visitAt.localeCompare(b.visitAt) || a.createdAt.localeCompare(b.createdAt))
  for (const n of ordered) for (const m of n.measures ?? []) {
    const key = [m.kind, m.name.toLowerCase(), m.side, m.unit].join('|')
    const point = { noteId: n.id, at: n.visitAt, value: m.value, evaluation: /\.evaluation$/.test(n.template) }
    const s = map.get(key)
    if (s) s.points.push(point)
    else map.set(key, { key, kind: m.kind, name: m.name, side: m.side, unit: m.unit, points: [point], baseline: point, latest: point, change: 0 })
  }
  return [...map.values()].map(s => {
    const baseline = s.points.find(p => p.evaluation) ?? s.points[0], latest = s.points[s.points.length - 1]
    return { ...s, baseline, latest, change: round(latest.value - baseline.value) }
  })
}

/** For a progress or discharge note: each series' baseline and its latest value at or before that visit. */
export function changesAt(series: Series[], note: any) {
  return series.flatMap(s => {
    const upTo = s.points.filter(p => p.at <= note.visitAt)
    const current = upTo.find(p => p.noteId === note.id) ?? upTo[upTo.length - 1]
    if (!current || current === s.baseline) return []
    return [{ key: s.key, kind: s.kind, name: s.name, side: s.side, unit: s.unit, baseline: s.baseline.value, baselineAt: s.baseline.at, current: current.value, change: round(current.value - s.baseline.value) }]
  })
}
