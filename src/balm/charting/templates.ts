import { clinicalElements } from './template-elements'
// PT, OT and speech-language templates for the four notes a US outpatient
// therapist writes in an episode: the initial evaluation, the daily (SOAP) note,
// the progress report and the discharge summary. A note stores the section
// labels it was written with, so changing a template never changes a saved note.
export type Discipline = 'pt' | 'ot' | 'slp'
export type Kind = 'evaluation' | 'daily' | 'progress' | 'reevaluation' | 'discharge'
export type Section = { id: string; label: string; help: string; required: boolean; choices?: string[] }
export type Template = { key: string; discipline: Discipline; kind: Kind; title: string; sections: Section[]; version?: number; schemaVersion?: number; bodyRegion?: string; diagnosisVariant?: string }

export const disciplines: Record<Discipline, string> = { pt: 'Physical therapy', ot: 'Occupational therapy', slp: 'Speech-language pathology' }
const short: Record<Discipline, string> = { pt: 'PT', ot: 'OT', slp: 'Speech' }
const kinds: Record<Kind, string> = { evaluation: 'initial evaluation', daily: 'daily note', progress: 'progress report', reevaluation: 're-evaluation', discharge: 'discharge summary' }

// What each discipline records under the shared headings.
const focus: Record<Discipline, { history: string; measures: string; daily: string; assessment: string; goals: string; plan: string }> = {
  pt: {
    history: 'Chief complaint, onset date and mechanism of injury, pain (0-10, location, behavior), aggravating and easing factors, prior level of function, relevant medical history and medications, red-flag screen, patient goals.',
    measures: 'Observation and posture, ROM (AROM/PROM in degrees), strength (MMT grades), special tests, palpation, joint mobility, neuro screen, gait and balance (e.g. TUG, Berg), functional outcome score (e.g. LEFS, ODI, NDI, QuickDASH).',
    daily: 'Interventions with parameters (exercises, sets x reps, load; manual techniques and grades; modalities), minutes per CPT code, objective measures taken today, patient response.',
    assessment: 'Physical therapy diagnosis and problem list, how impairments limit function, rehab potential, evaluation complexity (low, moderate or high) and why skilled PT is needed.',
    goals: 'Short-term goals (2-4 weeks) and long-term goals (by discharge): measurable, functional and time-bound, e.g. "Ascend 12 stairs reciprocally without rail in 4 weeks."',
    plan: 'Frequency and duration, planned interventions (CPT), home exercise program, patient education, referrals, next visit focus.',
  },
  ot: {
    history: 'Occupational profile: roles, routines, home set-up and supports, chief complaint and onset, hand dominance, pain, prior level of function in ADLs and IADLs, medical history, patient priorities.',
    measures: 'ADL and IADL performance with assist levels (independent to dependent), fine motor and coordination (e.g. 9-Hole Peg), grip and pinch strength, ROM, sensation, edema, cognition and visual perception screen, standardized scores (e.g. COPM, QuickDASH).',
    daily: 'Occupation-based interventions with set-up and assist level (ADL training, therapeutic activities, splinting, cognitive strategies), minutes per CPT code, measures taken today, patient response.',
    assessment: 'Occupational performance problems, contributing client factors and context, rehab potential, evaluation complexity and why skilled OT is needed.',
    goals: 'Short-term and long-term goals written in occupations, e.g. "Patient will don a pullover shirt with modified independence using adaptive techniques in 3 weeks."',
    plan: 'Frequency and duration, planned interventions (CPT), adaptive equipment and home program, caregiver training, next visit focus.',
  },
  slp: {
    history: 'Case history: referral concern, onset, medical and developmental history, hearing and vision status, languages spoken, school or work demands, patient and caregiver report and goals.',
    measures: 'Standardized test scores with standard scores and percentiles (e.g. CELF-5, WAB-R, GFTA-3), oral mechanism exam, speech intelligibility, receptive and expressive language, voice and fluency, cognitive-communication, swallow findings and diet (IDDSI level).',
    daily: 'Targets addressed with accuracy (e.g. "/s/ blends in phrases 16/20 = 80% with min cues"), cueing hierarchy, strategies trained, minutes, patient and caregiver response.',
    assessment: 'Communication or swallowing diagnosis and severity, prognosis with supporting factors, impact on daily communication or safe intake, and why skilled therapy is needed.',
    goals: 'Long-term goals and short-term objectives with accuracy, cue level and context, e.g. "Patient will produce /r/ in conversation with 90% accuracy across 3 sessions."',
    plan: 'Frequency and duration, treatment approach, home practice, diet and safety recommendations, referrals (e.g. audiology, instrumental swallow study), next session focus.',
  },
}

const s = (id: string, label: string, help: string, required = true): Section => ({ id, label, help, required })

function sections(d: Discipline, kind: Kind): Section[] {
  const f = focus[d]
  if (kind === 'evaluation') return [
    s('diagnosis', 'Diagnoses (ICD-10)', 'Medical and treatment diagnoses with ICD-10 codes, referral source and referring provider.'),
    s('subjective', 'Subjective', f.history), s('objective', 'Objective measures', f.measures),
    s('assessment', 'Assessment', f.assessment), s('goals', 'Goals', f.goals), s('plan', 'Plan', f.plan),
  ]
  if (kind === 'daily') return [
    s('subjective', 'Subjective', 'Patient report since the last visit: symptoms, pain (0-10), function, home program adherence.'),
    s('objective', 'Objective measures', f.daily),
    s('assessment', 'Assessment', 'Response to treatment, progress toward goals, skilled decisions made today and remaining limitations.'),
    s('goals', 'Goal progress', 'Status of each short- and long-term goal: met, progressing or not progressing, with today’s measure.'),
    s('plan', 'Plan', 'Plan for the next visit, home program changes, communication with the referring provider.'),
  ]
  if (kind === 'progress' || kind === 'reevaluation') return [
    s('period', 'Reporting period', 'Dates and visit numbers this report covers (Medicare: at least once every 10 treatment days).'),
    s('subjective', 'Subjective', 'Patient report of change since the evaluation or last progress report, current function and goals.'),
    s('objective', 'Objective measures', 'Re-measure what the evaluation measured and give both values: ' + f.measures),
    s('assessment', 'Assessment', 'Progress toward goals, barriers, why continued skilled care is needed, and any change to the diagnosis or prognosis.'),
    s('goals', 'Goals', 'Each goal marked met, progressing or not met with its measure; revised or new goals.'),
    s('plan', 'Plan', 'Continue, modify or discharge; updated frequency and duration; whether the plan of care needs recertification.'),
  ]
  return [
    s('reason', 'Reason for discharge', 'Goals met, plateau, patient choice, non-attendance, transfer of care or other.'),
    s('subjective', 'Subjective', 'Patient report at discharge: symptoms, function and satisfaction with outcomes.'),
    s('objective', 'Objective measures', 'Final measures beside the evaluation’s: ' + f.measures),
    s('assessment', 'Assessment', 'Overall outcome of the episode, remaining impairments and the patient’s readiness to manage independently.'),
    s('goals', 'Goals', 'Final status of every goal: met, partly met or not met, with the final measure.'),
    s('plan', 'Plan', 'Discharge instructions, home program, follow-up and referrals; when to return.'),
  ]
}

export const templates: Template[] = (['pt', 'ot', 'slp'] as Discipline[]).flatMap(d => (['evaluation', 'daily', 'progress', 'reevaluation', 'discharge'] as Kind[])
  .map(kind => ({ key: `${d}.${kind}`, discipline: d, kind, title: `${short[d]} ${kinds[kind]}`, version: 2, schemaVersion: 2, sections: [...sections(d, kind), ...clinicalElements(d, kind)].map(s => s.id === 'goals' ? { ...s, required: false } : s) })))

export const template = (key: unknown) => templates.find(t => t.key === key)
