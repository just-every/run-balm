import { audit, commit, insist } from '../domain/model'
import { attachmentRecord, attachmentResponse } from '../messages/attachments'
import { patientActor, portalGuard, type Patient } from './auth'

export async function portalAttachment(db: D1Database, patient: Patient, key: string) {
  const file = await attachmentRecord(db, key)
  insist(file.clientId === patient.clientId, 'attachment_not_found', 404)
  await commit(db, null, [portalGuard(db, patient), audit(db, patientActor, 'message.attachment_downloaded', patient.clientId, file.id)])
  return attachmentResponse(file)
}
