import {claimWork,saveFilingRule,recordFilingDate,recordClaimAction} from './claim-work'
import {biller} from '../domain/role-access'
import { insist, type Actor, type Data } from '../domain/model'
import { insuranceActor } from './access'
import { saveAuthorization, saveEnrollment, saveInsuranceSettings, savePayer, savePolicy } from './setup'
import { saveMedicareSettings, saveMedicareExpenses, saveRecognizedExpense } from './medicare'
import { saveMedicareService } from './medicare-claim'
export { medicareSpending, medicarePosition } from './medicare'
import { importEligibility, prepareEligibility, recordEligibility, submitEligibility } from './eligibility'
import { correctClaim, documentNecessity, draftAppeal, prepareClaim, scrubStoredClaim } from './claims'
import { prepareBatch, submitBatch } from './batches'
import { importAcknowledgment } from './acknowledgments'
import { importRemittance } from './remittances'
import {draftPayerBatch,addPayerLine,removePayerLine,attachPayerEob} from './manual-payers'
import {closePayerBatch} from './manual-payer-posting'
import type { InsuranceEnv } from './types'
export { insuranceFile, insuranceState, insuranceDownload } from './views'
export { bookingWarnings } from './authorization'
export { insuranceAdapter, adapterStatus, type InsuranceAdapter, type InsuranceSubmission, type InsuranceSubmissionResult } from './adapter'
export type { InsuranceEnv, ClaimSnapshot, ScrubError } from './types'

/** HTTP and UI share these commands. Every invocation resolves the live human;
 * clinical assertions remain exclusive to clinicians and the clinic owner. */
export async function insuranceCommand(env:InsuranceEnv,initial:Actor,name:string,input:Data) {
  insist(input&&typeof input==='object'&&!Array.isArray(input),'invalid_input')
  const clinical=['insurance.claim.necessity','insurance.denial.appeal','insurance.medicare.service.save'].includes(name)
  const who=await insuranceActor(env.DB,initial,!clinical),db=env.DB
  if(/^insurance\.payer_(batch|line|eob)\./.test(name))insist(who.role==='owner'||biller(who),'payer_batches_require_biller_or_owner',403)
  switch(name) {
    case 'insurance.work.read':return claimWork(db,initial,input)
    case 'insurance.filing.save':return saveFilingRule(db,initial,input)
    case 'insurance.filing.date':return recordFilingDate(db,initial,input)
    case 'insurance.claim.action':return recordClaimAction(db,initial,input)
    case 'insurance.settings.save':return saveInsuranceSettings(db,who,input)
    case 'insurance.payer.save':return savePayer(db,who,input)
    case 'insurance.enrollment.save':return saveEnrollment(db,who,input)
    case 'insurance.policy.save':return savePolicy(db,who,input)
    case 'insurance.authorization.save':return saveAuthorization(db,who,input)
    case 'insurance.medicare.save':return saveMedicareExpenses(db,who,input)
    case 'insurance.medicare.settings.save':return saveMedicareSettings(db,who,input)
    case 'insurance.medicare.recognized.save':return saveRecognizedExpense(db,who,input)
    case 'insurance.medicare.service.save':return saveMedicareService(db,who,input)
    case 'insurance.eligibility.prepare':return prepareEligibility(db,who,input)
    case 'insurance.eligibility.submit':return submitEligibility(env,who,input)
    case 'insurance.eligibility.import':return importEligibility(db,who,input)
    case 'insurance.eligibility.record':return recordEligibility(db,who,input)
    case 'insurance.claim.prepare':return prepareClaim(db,who,input)
    case 'insurance.claim.correct':return correctClaim(db,who,input)
    case 'insurance.claim.scrub':return scrubStoredClaim(db,who,input)
    case 'insurance.claim.necessity':return documentNecessity(db,who,input)
    case 'insurance.batch.prepare':return prepareBatch(db,who,input)
    case 'insurance.batch.submit':return submitBatch(env,who,input)
    case 'insurance.acknowledgment.import':return importAcknowledgment(db,who,input)
    case 'insurance.payer_batch.prepare':return draftPayerBatch(db,who,input)
    case 'insurance.payer_line.add':return addPayerLine(db,who,input)
    case 'insurance.payer_line.remove':return removePayerLine(db,who,input)
    case 'insurance.payer_eob.attach':return attachPayerEob(db,who,input)
    case 'insurance.payer_batch.close':return closePayerBatch(db,who,input)
    case 'insurance.remittance.import':return importRemittance(db,who,input)
    case 'insurance.denial.appeal':return draftAppeal(db,who,input)
  }
  insist(false,'unknown_insurance_command',404)
}
