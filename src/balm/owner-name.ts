// The owner's own name. A local install signs the owner in as "Owner"; claims
// and signed notes need a first and last name, so setup asks for the real one.
import { operatorAuth, type Bindings } from '../auth.server'
import { saveStaff } from './domain/clinic'
import { actor, fullName, human, insist, need, one, text, type Actor, type Data } from './domain/model'

export async function ownerProfile(db: D1Database, who: Actor) {
  if (who.role !== 'owner') return undefined
  const row = await one(db, 'SELECT display_name FROM oa_operators WHERE id=?', who.id)
  return { name: String(row?.display_name ?? ''), email: who.email, staffId: who.staffId ?? null }
}

/** Saves the sign-in name, and the owner's staff record too while it still carries the old name. */
export async function saveOwnerName(request: Request, env: Bindings, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const name = text(input.name, 'your_name', 120)
  insist(fullName(name), 'enter_your_first_and_last_name')
  const before = (await ownerProfile(env.DB, who))!.name
  const auth = operatorAuth(env)
  insist(auth.changeDisplayName, 'names_cannot_change_here', 404)
  await auth.changeDisplayName(request, { displayName: name })
  const staff = await one(env.DB, 'SELECT id,name,email,version FROM bm_staff WHERE lower(email)=lower(?) AND erased_at IS NULL', who.email)
  if (staff && (staff.name === before || !fullName(staff.name))) await saveStaff(env.DB, await actor(env.DB, who.id), { id: staff.id, name, email: staff.email, version: staff.version })
  return { name, staffRenamed: !!staff && (staff.name === before || !fullName(staff.name)) }
}
