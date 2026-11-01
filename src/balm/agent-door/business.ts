import { createBusinessSettings, type TeamAdapter } from '../../modules/business-settings/index.ts'
import { type Bindings } from '../../auth.server.ts'
import { actor } from '../domain/model.ts'

/** Pair existing clinic people. Business membership never creates a shadow clinic job. */
export function balmBusiness(env: Bindings) {
  const db = env.DB
  const team: TeamAdapter = {
    async ownerEmail() { return (await db.prepare("SELECT o.email FROM oa_operators o JOIN oa_bootstrap b ON b.claim_id=o.id WHERE b.singleton=1 AND o.status='active'").first<{email:string}>())?.email ?? null },
    async prepare({ members, managed, guard }) {
      const result = []
      for (const member of members) {
        const previous = managed.find(row => row.businessId === member.id)
        const operator = previous?.operatorId
          ? await db.prepare('SELECT id FROM oa_operators WHERE id=?').bind(previous.operatorId).first<{id:string}>()
          : await db.prepare('SELECT id FROM oa_operators WHERE lower(email)=lower(?)').bind(member.email).first<{id:string}>()
        let state: 'active'|'inactive'|'invited' = operator ? 'inactive' : 'invited'
        if (operator) { try { await actor(db, operator.id); state = 'active' } catch {} }
        result.push({ email: member.email, operatorId: operator?.id ?? null, invite: member.invite, state })
      }
      for (const previous of managed) if (!members.some(member => member.id === previous.businessId || member.email === previous.email)) result.push({ ...previous, state: 'inactive' as const })
      return { statements: [db.prepare(`INSERT INTO bs_assert(value) SELECT CASE WHEN ${guard.sql} THEN 1 ELSE NULL END`).bind(...guard.args)], rows: result, async afterCommit() {} }
    },
  }
  return createBusinessSettings({ db, trust: env.RER_BUSINESS_TRUST, business: { settings: 1, values: ['display_name'], team: { roles: { admin: 'member', member: 'member' } } }, team })
}
