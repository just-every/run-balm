import { ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import { actor, DomainError, type Actor } from '../domain/model.ts'
import { type Bindings } from '../../auth.server.ts'

export async function sponsor(env: Bindings, ctx: Pick<ToolContext,'person'|'agent'|'operationId'|'actor'|'approvers'|'clientId'|'scopes'>): Promise<Actor> {
  const who = await actor(env.DB, ctx.person.id)
  return { ...who, ...(ctx.clientId?.startsWith('balm-key:')?{keyId:ctx.clientId.slice(9),doorScopes:[...ctx.scopes]}:{}), agentAttribution: { id: ctx.agent.id, name: ctx.agent.name, sponsorName: ctx.person.name, label: ctx.actor.label, operationId: ctx.operationId, approvers: [...ctx.approvers] } }
}
export async function native<T>(action: () => Promise<T>): Promise<T> {
  try { return await action() } catch (error) {
    if (error instanceof DomainError) throw new ToolRefusal(error.status === 404 || error.status === 403 ? 'resource_unavailable' : error.code)
    throw error
  }
}
