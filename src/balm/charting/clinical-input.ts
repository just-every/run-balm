import { distinctServices, type DistinctService } from '../codesets/edits'
import type { Actor } from '../domain/model'
import { insist, type Data } from '../domain/model'
export type Goal = { id: string; term: 'short' | 'long'; text: string; target: string; deadline: string; status: 'met' | 'partly_met' | 'not_met' }
export type Flow = { kind: string; name: string; side: string; value: number; unit: string; sets: number | null; reps: number | null }
export type Clinical = { goals: Goal[]; precautions: string; flowsheet: Flow[]; sourceNoteId: string | null; distinctServices?: DistinctService[] }
export const emptyClinical = (): Clinical => ({ goals: [], precautions: '', flowsheet: [], sourceNoteId: null })
const clean = (value: unknown, label: string, max = 2000) => {
  insist(value === undefined || typeof value === 'string', `invalid_${label}`)
  const result = String(value ?? '').trim(); insist(result.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result), `invalid_${label}`); return result
}
/** Blank fields remain blank in drafts; clinical completeness is checked when signing. */
export function clinicalInput(input: Data, seed: Clinical = emptyClinical(), who?: Actor): Clinical {
  const provided = input.clinical && typeof input.clinical === 'object' && !Array.isArray(input.clinical) ? input.clinical as Data : input
  const hasRows = Object.keys(input).some(k => /^goal_\d+_text$/.test(k))
  const raw = provided.goals ?? (hasRows ? Array.from({ length: 12 }, (_, n) => ({ id: input[`goal_${n}_id`] || `goal-${n+1}`, term: input[`goal_${n}_term`] || 'short', text: input[`goal_${n}_text`], target: input[`goal_${n}_target`], deadline: input[`goal_${n}_deadline`], status: input[`goal_${n}_status`] || 'not_met' })).filter(g => g.text || g.target || g.deadline) : seed.goals)
  insist(Array.isArray(raw) && raw.length <= 12, 'at_most_twelve_goals')
  const goals: Goal[] = raw.map((g: Data, n: number) => {
    insist(g && typeof g === 'object', 'invalid_goal')
    insist(['short','long'].includes(g.term), 'choose_short_or_long_term_for_each_goal')
    insist(['met','partly_met','not_met'].includes(g.status), 'choose_each_goal_status')
    return { id: clean(g.id || `goal-${n+1}`, 'goal_id', 100), term: g.term, text: clean(g.text, 'goal'), target: clean(g.target, 'goal_target', 500), deadline: clean(g.deadline, 'goal_deadline', 100), status: g.status }
  })
  insist(new Set(goals.map(g => g.id)).size === goals.length, 'goal_ids_must_be_unique')
  const hasDistinctRows=Object.keys(input).some(k=>/^distinct_code1_\d+$/.test(k))
  const rawDistinct=provided.distinctServices??(hasDistinctRows?Array.from({length:20},(_,n)=>({code1:input[`distinct_code1_${n}`],code2:input[`distinct_code2_${n}`],modifier:input[`distinct_modifier_${n}`],reason:input[`distinct_reason_${n}`],attested:input[`distinct_attested_${n}`]==='on'})).filter(a=>a.code1||a.code2||a.reason||a.attested):seed.distinctServices??[])
  insist(!rawDistinct.length||who,'a_clinician_must_attest_distinct_services',403)
  const attestations=who?distinctServices(who,rawDistinct):[]
  // The flowsheet and source identity are server-derived, never trusted from a browser.
  return { distinctServices:attestations, goals, precautions: provided.precautions === undefined ? seed.precautions : clean(provided.precautions, 'precautions', 8000), flowsheet: seed.flowsheet, sourceNoteId: seed.sourceNoteId }
}

/** Format only the clinician's recorded goals, without adding clinical assertions. */
export const goalNarrative = (goals: Goal[]) => goals.map(g => `${g.term === 'short' ? 'Short-term' : 'Long-term'}: ${g.text} · ${g.target} · ${g.deadline} · ${g.status.replaceAll('_', ' ')}`).join('\n')
