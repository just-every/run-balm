import { insist, type Actor, type Data } from '../domain/model'
import { archiveExercise, assignExercise } from './programs'

export { consumePortalLink, portalPatient, requestPortalLink, signOutPortal, portalManagedNotice, portalNotice } from './auth'
export type { Patient } from './auth'
export { portalAction, portalDocument, portalHome, portalStatement } from './data'
export { portalExercisesFor } from './programs'
export type { Exercise } from './programs'

/** Only native clinical staff may assign or retire practice-made exercises. */
export async function portalCommand(db: D1Database, who: Actor, name: string, input: Data) {
  if (name === 'exercise.assign') return assignExercise(db, who, input)
  if (name === 'exercise.archive') return archiveExercise(db, who, input)
  insist(false, 'unknown_command', 404)
}
