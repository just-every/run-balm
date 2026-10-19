import { DomainError, insist, now, one, sha256, stmt, type Actor, type Data } from './model'

export type DraftRequestResult = { id: string; revision: number; template?: string }
type StoredRequest = { digest: string; result: string }

/** JSON object keys are sorted recursively; array order and string contents matter. */
function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    insist(Number.isFinite(value), 'invalid_draft_request_input')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(item => item === undefined ? 'null' : canonical(item)).join(',') + ']'
  insist(typeof value === 'object' && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'invalid_draft_request_input')
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}'
}

export interface DraftRequest {
  /** Return immediately when present, before inspecting current note revisions. */
  replay: DraftRequestResult | null
  /** Append these statements to the note mutation's existing guarded commit. */
  statements(result: DraftRequestResult): D1PreparedStatement[]
  /** After a failed commit, resolve a concurrent winner, or rethrow the error. No retry. */
  afterConflict(error: unknown): Promise<DraftRequestResult>
}

/**
 * Optional transport identity for note.write/note.amend. Call after resolving the
 * live actor and checking their clinical role, before revision-dependent checks.
 * No command input or clinical text is persisted; only its digest and receipt.
 */
export async function beginDraftRequest(db: D1Database, who: Actor, command: 'note.write' | 'note.amend', input: Data): Promise<DraftRequest | null> {
  insist(input.expectedActorId === undefined || input.expectedActorId === who.id, 'draft_author_changed_sign_in_again', 403)
  if (input.requestId === undefined) return null
  insist(typeof input.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId), 'invalid_request_id')
  insist(command === 'note.write' || command === 'note.amend', 'invalid_draft_request_command')
  const requestId = input.requestId.toLowerCase(), actorId = who.id
  const { requestId: _requestId, ...payload } = input
  const digest = await sha256(JSON.stringify(command) + '\n' + canonical(payload))
  const lookup = async (): Promise<DraftRequestResult | null> => {
    const stored = await one<StoredRequest>(db, 'SELECT digest,result FROM bm_draft_requests WHERE actor_id=? AND request_id=?', actorId, requestId)
    if (!stored) return null
    insist(stored.digest === digest, 'request_id_payload_conflict', 409)
    return JSON.parse(stored.result) as DraftRequestResult
  }
  const replay = await lookup()
  return {
    replay,
    statements(result) {
      insist(typeof result.id === 'string' && result.id.length > 0 && result.id.length <= 100 && Number.isSafeInteger(result.revision) && result.revision > 0, 'invalid_draft_request_result')
      insist(result.template === undefined || (typeof result.template === 'string' && result.template.length <= 40), 'invalid_draft_request_result')
      // Explicit fields prevent accidental persistence of a caller's clinical data.
      const receipt: DraftRequestResult = { id: result.id, revision: result.revision }
      if (result.template !== undefined) receipt.template = result.template
      // A plain INSERT is deliberate: a racing duplicate aborts and rolls back
      // its entire note batch, including any new immutable revision and audit.
      return [stmt(db, 'INSERT INTO bm_draft_requests(actor_id,request_id,digest,result,created_at) VALUES(?,?,?,?,?)', actorId, requestId, digest, JSON.stringify(receipt), now())]
    },
    async afterConflict(error) {
      if (!(error instanceof DomainError) || error.status !== 409) throw error
      const result = await lookup()
      if (result) return result
      throw error
    },
  }
}
