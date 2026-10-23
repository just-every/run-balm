import { field, h, hidden, select, textarea } from './shared'
import type { Clinical } from '../charting/clinical-input'
import { emptyClinical } from '../charting/clinical-input'

const statuses: [string,string][] = [['not_met','Not met'],['partly_met','Partly met'],['met','Met']]
export function clinicalFields(value: Clinical | null) {
  const c = value ?? emptyClinical()
  return `<fieldset><legend>Measurable goals and precautions</legend><p class="help">Keep each goal’s identity when recording its progress. Leave unused rows empty. Short- and long-term goals need a measurable target and time frame.</p>${Array.from({length: Math.min(12,Math.max(4,c.goals.length+2))}, (_,n) => {
    const g = c.goals[n]
    return `<details${g ? ' open' : ''}><summary>Goal ${n+1}${g ? ': '+h(g.text) : ''}</summary>${hidden(`goal_${n}_id`,g?.id ?? `goal-${n+1}`)}${select(`goal_${n}_term`,'Term',[['short','Short-term'],['long','Long-term']],g?.term ?? 'short')}${field(`goal_${n}_text`,'Goal',g?.text ?? '','text','maxlength="2000"')}${field(`goal_${n}_target`,'Measurable target',g?.target ?? '','text','maxlength="500"')}${field(`goal_${n}_deadline`,'Time frame',g?.deadline ?? '','text','maxlength="100"')}${select(`goal_${n}_status`,'Status',statuses,g?.status ?? 'not_met')}</details>`
  }).join('')}${textarea('precautions','Precautions',c.precautions,'maxlength="8000"')}</fieldset>` + flowsheetSummary(c)
}
export function flowsheetSummary(c: Clinical) {
  return c.flowsheet.length ? `<h4>Carried flowsheet values</h4><p class="help">Last signed values, carried for review. Record today’s measurements separately.</p><ul>${c.flowsheet.map(m => `<li>${h(m.name)} · ${h(m.side)} · ${h(m.value)} ${h(m.unit)}${m.sets ? ` · ${h(m.sets)} × ${h(m.reps)}` : ''}</li>`).join('')}</ul>` : ''
}
export function clinicalSummary(c: Clinical | null) {
  if (!c) return ''
  return `${c.goals.length ? `<h4>Goals and status</h4><dl>${c.goals.map(g => `<dt>${h(g.term === 'short' ? 'Short-term' : 'Long-term')} · ${h(g.text)}</dt><dd>${h(g.target)} · ${h(g.deadline)} · <strong>${h(statuses.find(s=>s[0]===g.status)?.[1] ?? g.status)}</strong></dd>`).join('')}</dl>` : ''}${c.precautions ? `<h4>Precautions</h4><p>${h(c.precautions)}</p>` : ''}${flowsheetSummary(c)}`
}
/** Preview only from notes already authorized and audited in the client file. */
export function composeCarry(f: any, visit: any, t: any) {
  if (!visit?.episodeId || !t) return { sections: {}, clinical: emptyClinical() }
  const previous = [...f.notes].filter((n:any) => n.status === 'signed' && n.episodeId === visit.episodeId && n.templateDefinition?.discipline === t.discipline && n.visitAt < visit.start_at).sort((a:any,b:any)=>b.visitAt.localeCompare(a.visitAt) || b.signature.signedAt.localeCompare(a.signature.signedAt))[0]
  if (!previous) return { sections: {}, clinical: emptyClinical() }
  const revision = previous.revisions.find((r:any)=>r.number===previous.signature.revision) ?? previous.revisions[0]
  const clinical: Clinical = JSON.parse(JSON.stringify(revision.clinical ?? emptyClinical()))
  const map = new Map(clinical.flowsheet.map(m=>[[m.kind,m.name.toLowerCase(),m.side,m.unit].join('|'),m]))
  for (const m of previous.measures.filter((m:any)=>m.kind==='flowsheet')) map.set([m.kind,m.name.toLowerCase(),m.side,m.unit].join('|'),m)
  clinical.flowsheet = [...map.values()]; clinical.sourceNoteId = previous.id
  const sections = Object.fromEntries((revision.sections ?? []).filter((s:any)=>['diagnosis','goals','plan','frequency','duration','planned_interventions'].includes(s.id)).map((s:any)=>[s.id,s.text]))
  return { sections, clinical }
}
