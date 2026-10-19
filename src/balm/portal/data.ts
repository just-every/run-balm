import { patientPlans } from '../payments/plans'
import { periodSuperbillPdf } from '../payments/superbill-period'
import { type Bindings } from '../../auth.server'
import { audit, commit, guard, id, insist, now, one, rows, sha256, stmt, text, type Data } from '../domain/model'
import { savePatientMessage } from '../messages/patient'
import { destination, recipients } from '../messages/routing'
import { thread } from '../messages/thread'
import { paymentBlock } from '../payments/connect'
import { receiptPdf, statementPdf, superbillPdf } from '../payments/documents'
import { ledger } from '../payments/ledger'
import { patientActor, portalGuard, portalToken, type Patient } from './auth'
import { exerciseProgress, patientExercises } from './programs'

/** The session's client id is the only patient selector accepted by portal reads. */
export async function portalHome(env: Bindings, patient: Patient) {
  const db = env.DB, at = now()
  const [clinic, appointments, exercises, messages, balance, block, receipts, superbills, messageRecipients] = await Promise.all([
    one<{ clinic_name: string; time_zone: string }>(db, 'SELECT clinic_name,time_zone FROM bm_settings WHERE id=1'),
    rows(db, `SELECT a.id,a.start_at,a.end_at,a.status,p.name AS practitioner,s.name AS service,
      CASE WHEN a.status='booked' AND a.end_at>? AND a.intake_token_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) THEN 1 ELSE 0 END AS intake_open
      FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id
      WHERE a.client_id=? ORDER BY a.start_at`, at, patient.clientId),
    patientExercises(db, patient), thread(db, patient.clientId), ledger(db, patient.clientId), paymentBlock(env, db),
    rows(db, "SELECT id,receipt_number,amount_cents,succeeded_at FROM bm_card_payments WHERE client_id=? AND status='succeeded' AND receipt_number IS NOT NULL ORDER BY succeeded_at DESC", patient.clientId),
    rows(db, "SELECT id,number,approved_at FROM bm_invoices WHERE client_id=? AND status='approved' ORDER BY number DESC", patient.clientId),
    recipients(db, patient.clientId),
  ])
  await commit(db, null, [portalGuard(db, patient), audit(db, patientActor, 'portal.viewed', patient.clientId),
    audit(db, patientActor, 'message.thread_read', patient.clientId), ...messages.map(m => audit(db, patientActor, 'message.read', patient.clientId, m.id)),
    audit(db, patientActor, 'statement.opened', patient.clientId),
  ])
  return {
    clinic: clinic!, patient: { firstName: patient.firstName, lastName: patient.lastName },
    upcoming: appointments.filter(a => a.end_at >= at && a.status === 'booked'),
    past: appointments.filter(a => a.end_at < at || a.status !== 'booked').reverse(),
    intake: appointments.filter(a => a.intake_open).map(a => ({ appointmentId: a.id, id: a.id, startAt: a.start_at, service: a.service })),
    exercises, messageRecipients, messages: messages.map(({ notification, ...m }) => m),
    paymentPlans: await patientPlans(db, patient.clientId),
    billing: { ...balance, block, statementUrl: '/portal/statement.pdf', receipts, superbills },
  }
}

async function intakeOpen(db: D1Database, patient: Patient, input: Data) {
  const appointmentId = text(input.appointmentId ?? input.id, 'appointment', 100), token = portalToken()
  const available = `EXISTS(SELECT 1 FROM bm_appointments a WHERE a.id=? AND a.client_id=? AND a.status='booked'
    AND a.end_at>? AND a.intake_token_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id))`
  insist((await one<{ ok: number }>(db, `SELECT CASE WHEN (${available}) THEN 1 ELSE 0 END AS ok`, appointmentId, patient.clientId, now()))?.ok, 'open_intake_not_found', 404)
  await commit(db, null, [portalGuard(db, patient), guard(db, available, appointmentId, patient.clientId, now()),
    stmt(db, 'UPDATE bm_appointments SET intake_token_hash=? WHERE id=?', await sha256(token), appointmentId),
    audit(db, patientActor, 'intake.opened', patient.clientId, appointmentId),
  ])
  return { redirect: '/intake/' + token }
}

/** Patient sessions and private links share the immutable message writer. */
async function messageSend(env: Bindings, patient: Patient, input: Data) {
  const target = await destination(env.DB, patient.clientId, input)
  return savePatientMessage(env, patient.clientId, input, target, portalGuard(env.DB, patient), patientActor)
}

async function paymentOpen(env: Bindings, patient: Patient, input: Data) {
  const db = env.DB, block = await paymentBlock(env, db)
  insist(!block, block ?? '', 409)
  const token = portalToken(), linkId = id(), purpose = input.purpose === 'card' ? 'card' : 'balance'
  await commit(db, null, [portalGuard(db, patient),
    stmt(db, 'INSERT INTO bm_pay_links(id,token_hash,client_id,purpose,created_by,created_at,expires_at,delivery,delivery_result) VALUES(?,?,?,?,?,?,?,?,?)',
      linkId, await sha256(token), patient.clientId, purpose, `patient-portal:${patient.sessionId}`, now(), patient.expiresAt, 'shown', 'portal'),
    audit(db, patientActor, 'paylink.portal_opened', patient.clientId, linkId, purpose),
  ])
  return { redirect: '/pay/' + token }
}

export async function portalAction(env: Bindings, patient: Patient, name: string, input: Data) {
  switch (name) {
    case 'exercise.seen': return exerciseProgress(env.DB, patient, input, false)
    case 'exercise.done': return exerciseProgress(env.DB, patient, input, true)
    case 'message.send': return messageSend(env, patient, input)
    case 'intake.open': return intakeOpen(env.DB, patient, input)
    case 'payment.open': return paymentOpen(env, patient, input)
  }
  insist(false, 'unknown_command', 404)
}

/** Statements use the existing ledger/PDF directly, without making another bearer link. */
export async function portalStatement(db: D1Database, patient: Patient) {
  const document = await statementPdf(db, patient.clientId)
  await commit(db, null, [portalGuard(db, patient), audit(db, patientActor, 'statement.downloaded', patient.clientId)])
  return document
}

export async function portalDocument(db: D1Database, patient: Patient, kind: 'receipt' | 'superbill', key: string) {
  insist(kind === 'receipt' || kind === 'superbill', 'document_not_found', 404)
  const allowed = kind === 'receipt'
    ? await one(db, "SELECT id FROM bm_card_payments WHERE id=? AND client_id=? AND status='succeeded' AND receipt_number IS NOT NULL", key, patient.clientId)
    : await one(db, "SELECT id FROM bm_invoices WHERE id=? AND client_id=? AND status='approved'", key, patient.clientId)
  insist(allowed, 'document_not_found', 404)
  const document = kind === 'receipt' ? await receiptPdf(db, key) : await superbillPdf(db, key)
  await commit(db, null, [portalGuard(db, patient), audit(db, patientActor, kind + '.downloaded', patient.clientId, key)])
  return document
}


export async function portalPeriodSuperbill(db: D1Database, patient: Patient, from: string, to: string) {
  const document = await periodSuperbillPdf(db, patient.clientId, from, to)
  await commit(db, null, [portalGuard(db, patient), audit(db, patientActor, 'superbill.downloaded', patient.clientId, null, 'period')])
  return document
}
