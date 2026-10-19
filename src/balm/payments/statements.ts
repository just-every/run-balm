import { guard, id, insist, one, rows, stmt } from '../domain/model'
import { statementPdf } from './documents'

// Encode bounded, three-byte-aligned chunks rather than spreading a whole PDF
// into a single function call. Only the final chunk may contain base64 padding.
function originalBase64(bytes: Uint8Array) {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))))
  }
  return chunks.join('')
}

/** Call only after resolving live desk or portal authority for this patient. */
export function statementsFor(db: D1Database, clientId: string) {
  return rows(db, `SELECT id,reminder_id,due_on,amount_cents,issued_at FROM bm_patient_statements
    WHERE client_id=? ORDER BY issued_at DESC,id DESC`, clientId)
}

/** Exact patient association is required even when a caller already knows the id. */
export async function statementOriginal(db: D1Database, clientId: string, statementId: string) {
  const original = await one(db, `SELECT id,due_on,original_base64 FROM bm_patient_statements WHERE client_id=? AND id=?`, clientId, statementId)
  insist(original, 'statement_not_found', 404)
  const binary = atob(original.original_base64 as string), bytes = new Uint8Array(binary.length)
  for (let offset = 0; offset < binary.length; offset++) bytes[offset] = binary.charCodeAt(offset)
  return { name: `statement-${original.due_on}-${original.id}.pdf`, bytes }
}

/** Insert in the same guarded batch that reserves the notice and advances its date. */
export async function preparedStatement(db: D1Database, clientId: string, reminderId: string, dueOn: string, at: string, balanceCents: number) {
  const epoch = (await one(db, 'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
  const document = await statementPdf(db, clientId)
  // A payment during preparation must not leave the original and its list amount
  // describing different balances. The scheduler can reconsider on its next tick.
  insist(document.balanceCents === balanceCents, 'changed_refresh_and_retry', 409)
  const statementId = id()
  return {
    id: statementId,
    unchanged: guard(db, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', epoch),
    statement: stmt(db, `INSERT INTO bm_patient_statements(id,client_id,reminder_id,due_on,amount_cents,original_base64,issued_at) VALUES(?,?,?,?,?,?,?)`,
      statementId, clientId, reminderId, dueOn, balanceCents, originalBase64(document.bytes), at),
  }
}
