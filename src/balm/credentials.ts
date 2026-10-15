// Adapted from Strap's native invitations and owner-bound preparation keys
// (src/strap/credentials.ts, just-every/run-strap @ 92c3892).
import { operatorAuth, type Bindings } from '../auth.server'
import { actor, type Actor } from './domain'
import { audit, commit, DomainError, insist, sha256 } from './domain/model'

export const fail = (message: string, status = 400): never => { throw new DomainError(message, status) }

export async function principal(request: Request, env: Bindings, agent = false): Promise<Actor> {
  if (agent) {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token || token.length > 200) fail('agent_credential_required', 401)
    const key = await env.DB.prepare(`SELECT k.owner_id FROM bm_agent_keys k JOIN oa_operators o ON o.id=k.owner_id
      WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND o.role='owner' AND o.status='active' AND o.version=k.owner_version`).bind(await sha256(token!), Date.now()).first<{ owner_id: string }>()
    if (!key) fail('agent_credential_expired_or_revoked', 401)
    return actor(env.DB, key!.owner_id, true)
  }
  const session = await operatorAuth(env).getSession(request)
  if (!session) fail('sign_in_required', 401)
  return actor(env.DB, session!.operator.id)
}

export async function agentKeys(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return []
  return (await env.DB.prepare('SELECT id,label,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM bm_agent_keys WHERE owner_id=? ORDER BY created_at DESC').bind(who.id).all()).results
}

export async function credentialCommand(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  insist(who.role === 'owner', 'only_the_owner_manages_access', 403)
  if (name === 'agent.create') {
    const label = String(input.label ?? '').trim()
    insist(label && label.length <= 80, 'invalid_label')
    const keyId = crypto.randomUUID(), token = 'balm_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''), at = Date.now()
    const result = await env.DB.prepare(`INSERT INTO bm_agent_keys(id,owner_id,owner_version,label,token_hash,created_at,expires_at)
      SELECT ?,id,version,?,?,?,? FROM oa_operators WHERE id=? AND role='owner' AND status='active'`).bind(keyId, label, await sha256(token), at, at + 30 * 86400_000, who.id).run()
    insist(result.meta.changes === 1, 'owner_access_changed', 403)
    await commit(env.DB, who, [audit(env.DB, who, 'agent_key.created', null, keyId)])
    return { id: keyId, token, expiresAt: at + 30 * 86400_000 }
  }
  if (name === 'agent.revoke') {
    await env.DB.prepare('UPDATE bm_agent_keys SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(Date.now(), String(input.id ?? ''), who.id).run()
    await commit(env.DB, who, [audit(env.DB, who, 'agent_key.revoked', null, String(input.id ?? ''))])
    return { revoked: true }
  }
  if (name === 'staff.invite') {
    const staff = await env.DB.prepare('SELECT * FROM bm_staff WHERE id=? AND active=1 AND erased_at IS NULL').bind(String(input.id ?? '')).first<any>()
    insist(staff, 'activate_the_staff_member_before_inviting', 409)
    await operatorAuth(env).invite(request, { email: staff.email, displayName: staff.name, role: 'member', returnTo: '/app' })
    return { invited: true }
  }
  return fail('unknown_command', 404)
}
