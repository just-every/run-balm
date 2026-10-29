import { operatorAuthPeople, type PeopleAdapter, type Person } from '../../modules/agent-door/index.ts'
import { actor, DomainError } from '../domain/model.ts'
import { operatorAuth, authConfig, type Bindings } from '../../auth.server.ts'
import { requireSecondStep } from '../security/second-step.ts'

/** Business identifiers select durable native ids; native clinic admission remains authoritative. */
export function balmPeople(env: Bindings): PeopleAdapter {
  const native = operatorAuthPeople({ db: env.DB, allowList: authConfig(env).allowList, session: async request => {
    const session = await operatorAuth(env).getSession(request)
    if (!session) return null
    try { await requireSecondStep(env, request, session); return session } catch { return null }
  } })
  async function businessMember(person: Person): Promise<{id:string;role:'owner'|'editor'|null}|null> {
    const settings=await env.DB.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id:string}>()
    if(!settings)return null
    const bootstrap=await env.DB.prepare('SELECT claim_id FROM oa_bootstrap WHERE singleton=1').first<{claim_id:string}>()
    if(settings.owner_id && bootstrap?.claim_id===person.id)return {id:settings.owner_id,role:'owner'}
    const row=await env.DB.prepare("SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND state='active' AND business_id IS NOT NULL").bind(person.id).first<{business_id:string;business_role:string}>()
    return row?{id:row.business_id,role:row.business_role==='admin'?'editor':null}:null
  }
  const policyRoles=new Map<string,'owner'|'editor'|null>()
  async function admitted(person: Person | null) {
    if (!person?.active) return null
    try { await actor(env.DB, person.id); const member=await businessMember(person); policyRoles.set(person.id,env.RER_OWNER_CLAIM_PUBLIC_KEYS?member?.role??null:person.role==='owner'?'owner':null);return person } catch (error) { if (error instanceof DomainError) return null; throw error }
  }
  return {
    person: async id => admitted(await native.person(id)),
    sponsor: async claims => {
      const settings=await env.DB.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id:string}>()
      if(!settings)return null
      const binding=settings.owner_id===claims.sub
        ? await env.DB.prepare('SELECT claim_id AS id FROM oa_bootstrap WHERE singleton=1').first<{id:string}>()
        : await env.DB.prepare("SELECT operator_id AS id FROM bs_team WHERE business_id=? AND state='active'").bind(claims.sub).first<{id:string}>()
      return binding?.id?admitted(await native.person(binding.id)):null
    },
    session: async request => admitted(await native.session(request)),
    businessMember,
    businessRole: person => policyRoles.get(person.id) ?? null,
  }
}
