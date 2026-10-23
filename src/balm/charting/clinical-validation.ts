import { insist, type Data } from '../domain/model'
import { cpt } from './cpt'
import type { Clinical } from './clinical-input'
import type { Template } from './templates'

export function validateClinical(t: Template, revision: Data, sections: Data[]) {
  const blank = t.sections.find(s => s.required && !String(sections.find(x => x.id === s.id)?.text ?? '').trim())
  insist(!blank, `Complete ${blank?.label} before signing.`)
  if (!t.schemaVersion || t.schemaVersion < 2) return
  const clinical: Clinical = revision.clinical ? JSON.parse(revision.clinical) : { goals: [], precautions: '', flowsheet: [], sourceNoteId: null }
  insist(clinical.goals.length > 0, 'Record measurable goals before signing.')
  for (const goal of clinical.goals) {
    insist(goal.text && goal.target && goal.deadline, `Complete goal ${goal.id}: description, measurable target and time frame.`)
    insist(['met','partly_met','not_met'].includes(goal.status), `Record the status of goal ${goal.id}.`)
  }
  if (t.kind === 'evaluation') {
    insist(clinical.goals.some(g => g.term === 'short') && clinical.goals.some(g => g.term === 'long'), 'Record short-term and long-term goals before signing.')
    const accepted = t.discipline === 'pt' ? ['97161','97162','97163'] : t.discipline === 'ot' ? ['97165','97166','97167'] : ['92521','92522','92523','92524','92610']
    insist(JSON.parse(revision.charges ?? '[]').some((c: Data) => accepted.includes(c.code)), 'Record the discipline evaluation complexity CPT code before signing.')
  }
  if (t.kind === 'daily') {
    const charges: Data[] = JSON.parse(revision.charges ?? '[]')
    insist(charges.length > 0, 'Record each intervention with its CPT code before signing.')
    for (const charge of charges) {
      insist(Number(charge.minutes) > 0, `Record minutes for intervention ${charge.code} before signing.`)
      insist(String(charge.parameters ?? '').trim(), `Record parameters for intervention ${charge.code} before signing.`)
    }
    const documentation = JSON.parse(revision.documentation ?? '{}')
    insist(documentation.totalTimedMinutes !== null && documentation.totalTimedMinutes !== undefined, 'Record total timed minutes before signing.')
    insist(documentation.totalTreatmentMinutes !== null && documentation.totalTreatmentMinutes !== undefined, 'Record total treatment minutes before signing.')
    const timed = charges.filter(c => cpt(c.code)?.timed).reduce((sum,c) => sum + Number(c.minutes),0)
    const total = charges.reduce((sum,c) => sum + Number(c.minutes),0)
    insist(documentation.totalTimedMinutes === timed, 'Total timed minutes must equal the timed interventions.')
    insist(documentation.totalTreatmentMinutes >= total, 'Total treatment minutes must include every intervention.')
  }
}
