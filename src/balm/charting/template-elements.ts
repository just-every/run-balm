import type { Discipline, Kind, Section } from './templates'

const field = (id: string, label: string, help = '', choices?: string[]): Section => ({ id, label, help, required: true, ...(choices ? { choices } : {}) })
/** Individually named clinical elements; prompts never supply clinical answers. */
export function clinicalElements(discipline: Discipline, kind: Kind): Section[] {
  if (kind === 'evaluation') return [
    field('condition', 'Presenting condition'), field('onset', 'Onset and mechanism'), field('prior_function', 'Prior level of function'),
    field('medical_history', 'Medical history'), field('medications', 'Medications'), field('systems_review', 'Systems review'),
    ...(discipline === 'pt' ? [field('rom', 'Range of motion'), field('strength', 'Strength'), field('special_tests', 'Special tests'), field('gait_balance', 'Gait and balance')]
      : discipline === 'ot' ? [field('adl_iadl', 'ADL and IADL performance'), field('upper_extremity', 'Upper-extremity and fine motor function'), field('cognition', 'Cognition screen')]
      : [field('standardized_assessment', 'Standardized speech, language, swallowing or voice assessment')]),
    field('prognosis', 'Prognosis', '', ['Good', 'Fair', 'Guarded', 'Poor']), field('frequency', 'Plan frequency'), field('duration', 'Plan duration'), field('planned_interventions', 'Planned interventions'),
  ]
  if (kind === 'daily') return [field('diagnosis', 'Diagnoses (ICD-10)'), field('response', 'Patient response to treatment')]
  if (kind === 'progress' || kind === 'reevaluation') return [field('diagnosis', 'Diagnoses (ICD-10)'), field('comparison', 'Objective measures compared with evaluation'), field('skilled_need', 'Justification for continued skilled care'), field('frequency', 'Updated frequency'), field('duration', 'Updated duration'), field('planned_interventions', 'Updated interventions')]
  return [field('diagnosis', 'Diagnoses (ICD-10)'), field('final_measures', 'Final measures'), field('home_program', 'Home program')]
}
export const bodyRegions = ['General', 'Head and neck', 'Spine', 'Upper extremity', 'Lower extremity', 'Communication', 'Swallowing']
