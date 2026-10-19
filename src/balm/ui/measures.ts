// CHART-005 on the client file: each note's measures (recorded while its draft is
// open), the change since evaluation on progress and discharge notes, and one graph
// per measure across the visits this reader can see.
import { measureKinds, shown, sides } from '../charting/measures'
import { field, form, h, hidden, panel, select, usDate, zoneOf } from './shared'

const sideLabel: Record<string, string> = { none: '', left: 'left', right: 'right', both: 'bilateral' }
const title = (m: any) => `${m.name}${sideLabel[m.side] ? ` (${sideLabel[m.side]})` : ''}`
const amount = (kind: string, value: number, unit: string) => kind === 'mmt' ? `grade ${shown(kind, value)}` : `${shown(kind, value)} ${unit}`
const signed = (kind: string, n: number, unit: string) => kind === 'mmt' ? `${n > 0 ? '+' : ''}${n} grade` : `${n > 0 ? '+' : ''}${n} ${unit}`

export function noteMeasures(s: any, f: any, n: any) {
  const path = `/app/clients/${f.client.id}#note-${n.id}`, open = n.mine && n.status !== 'signed'
  const list = n.measures?.length ? `<div class="table"><table class="measures"><thead><tr><th>Measure</th><th>Type</th><th>Result</th>${open ? '<th></th>' : ''}</tr></thead><tbody>${n.measures.map((m: any) =>
    `<tr><td>${h(title(m))}</td><td>${h(measureKinds[m.kind as keyof typeof measureKinds].label)}</td><td>${h(amount(m.kind, m.value, m.unit))}${m.sets ? ` · ${h(m.sets)} × ${h(m.reps)}` : ''}</td>${open ? `<td>${form('note.measure_remove', path, hidden('id', m.id), 'Remove', true)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''
  if (!open) return list ? `<h4>Objective measures</h4>${list}` : ''
  const units = [...new Set(Object.values(measureKinds).flatMap(k => k.units))]
  const add = `<details><summary>Record a measure</summary>${form('note.measure', path, hidden('noteId', n.id)
    + `<div class="pair">${select('kind', 'Type', Object.entries(measureKinds).map(([k, v]) => [k, v.label]))}${field('name', 'Measure', '', 'text', 'required maxlength="80" placeholder="Knee flexion, LEFS, TUG"')}</div>`
    + `<div class="pair">${select('side', 'Side', sides.map(x => [x, sideLabel[x] || 'Not sided']))}${field('value', 'Value', '', 'text', 'required maxlength="9" inputmode="decimal" placeholder="120, 4+, 52"')}${select('unit', 'Unit', units.map(u => [u, u]))}</div>`
    + `<div class="pair">${field('sets', 'Sets (flowsheet)', '', 'number', 'min="1" max="100"')}${field('reps', 'Reps (flowsheet)', '', 'number', 'min="1" max="1000"')}</div>`
    + '<p class="help">Muscle tests take grades 0 to 5 with + or −. Measures lock when the note is signed.</p>', 'Record measure')}</details>`
  return `<h4>Objective measures</h4>${list}${add}`
}

/** On a progress or discharge note: each measure beside its evaluation value. */
export function progressChanges(s: any, f: any, n: any) {
  const changes = f.measureChanges?.[n.id]
  if (!changes?.length) return ''
  return `<h4>Change since evaluation</h4><div class="table"><table class="measure-changes"><thead><tr><th>Measure</th><th>Evaluation</th><th>This report</th><th>Change</th></tr></thead><tbody>${changes.map((c: any) =>
    `<tr data-measure="${h(c.key)}"><td>${h(title(c))}</td><td>${h(amount(c.kind, c.baseline, c.unit))} · ${h(usDate(c.baselineAt, zoneOf(s)))}</td><td>${h(amount(c.kind, c.current, c.unit))}</td><td>${h(signed(c.kind, c.change, c.unit))}</td></tr>`).join('')}</tbody></table></div>`
}

function graph(s: any, m: any) {
  const W = 320, H = 120, P = 18, values = m.points.map((p: any) => p.value), lo = Math.min(...values), hi = Math.max(...values)
  const x = (i: number) => m.points.length === 1 ? W / 2 : P + i * (W - 2 * P) / (m.points.length - 1)
  const y = (v: number) => hi === lo ? H / 2 : H - P - (v - lo) * (H - 2 * P) / (hi - lo)
  const dots = m.points.map((p: any, i: number) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" data-value="${h(p.value)}" data-at="${h(p.at)}"><title>${h(usDate(p.at, zoneOf(s)))}: ${h(amount(m.kind, p.value, m.unit))}</title></circle>`).join('')
  return `<svg class="measure-graph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="currentColor" role="img" aria-label="${h(title(m))} over ${m.points.length} visits" data-measure="${h(m.key)}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${m.points.map((p: any, i: number) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"/>${dots}</svg>`
}

export function measuresPanel(s: any, f: any) {
  if (!f.measures?.length) return ''
  return panel('Objective measures', f.measures.map((m: any) => `<article class="entry"><h3>${h(title(m))}</h3><p>Evaluation ${h(amount(m.kind, m.baseline.value, m.unit))} · latest ${h(amount(m.kind, m.latest.value, m.unit))} · change ${h(signed(m.kind, m.change, m.unit))}</p>${graph(s, m)}</article>`).join(''), 'full', 'measures')
}
