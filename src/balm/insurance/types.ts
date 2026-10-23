import type { validateCoding, DistinctService } from '../codesets'
import type { CobFacts } from './cob-types'
import type { MedicareService } from './medicare-claim'
import type { Bindings } from '../../auth.server'
export type InsuranceEnv = Bindings & { BALM_INSURANCE_ADAPTER_URL?: string; BALM_INSURANCE_ADAPTER_TOKEN?: string }
export type ScrubError = { code: string; field: string; message: string; children?: Record<string,any>[]; version?:string; releaseId?:string }
export type ClaimLine = { code: string; minutes: number; units: number; modifiers: string[]; amountCents: number; allowedCents?:number; diagnosisPointers: number[] }
export type ClaimSnapshot = {
  coding?: Awaited<ReturnType<typeof validateCoding>>
  distinctServices?: DistinctService[]
  cob?: CobFacts
  patient: { first: string; last: string; dob: string; sex: string }
  subscriber: { first: string; last: string; dob: string; sex: string; relationship: string; memberId: string; group: string }
  address: { street: string; city: string; state: string; postal: string }
  payer: { id: string; name: string; code: string; receiver: string; medicare: boolean; unitMethod: string | null; fixedUnitMinutes?: number }
  billing: { name: string; npi: string; taxId: string; address: string; city: string; state: string; postal: string; sender: string; contact: string; phone: string; production: boolean }
  rendering: { first: string; last: string; npi: string; taxonomy: string; enrolled: boolean }
  referring: { first: string; last: string; npi: string } | null
  supervisionErrors?: string[]
  belowThresholdCodes?: string[]
  authorizationExhausted?: boolean; authorizationNotCovered?: boolean
  authorization: string | null; serviceDate: string; diagnoses: string[]; lines: ClaimLine[]
  signedNotes: { id: string; digest: string; revision: number }[]
  invoiceId: string; invoiceCents: number; attended: boolean; requiresReferral: boolean
  kx: { required: boolean; thresholdCents: number | null; usedCents: number; projectedCents: number; group: 'pt_slp' | 'ot'; year: number; reviewCents?:number|null; targetedReview?:boolean; source?:string; externalUsedCents?:number }
  medicareServices?:Record<string,MedicareService>
  basis?: Record<string, any>; medicalNecessity: string; frequency: '1' | '7'; originalControl: string
}
export type BookingWarning = { code: string; message: string; policyId: string; authorizationId?: string; remainingVisits?: number; remainingAllowance?: number; allowanceKind?: 'visits' | 'units'; expiresOn?: string; blocking: boolean }
