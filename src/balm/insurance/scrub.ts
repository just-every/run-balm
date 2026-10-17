import { validNpi, parseIcd10 } from '../payments/codes'
import type { ClaimSnapshot, ScrubError } from './types'

/** Each refusal is named and tied to a field the biller can correct. No claim
 * is marked clean by guessing missing provider, diagnosis or pricing facts. */
export function scrubClaim(s:ClaimSnapshot):ScrubError[] {
  const errors:ScrubError[]=[],add=(code:string,field:string,message:string)=>errors.push({code,field,message})
  if(!s.attended)add('visit_not_attended','appointment','Mark the visit attended before claiming.')
  if(!s.signedNotes.length)add('signed_note_required','note','Sign the treatment note before claiming.')
  if(!s.payer.unitMethod)add('payer_unit_method_missing','payer.unitMethod',`Choose the timed-unit method for ${s.payer.name}.`)
  if(!s.rendering.enrolled)add('provider_enrollment_missing','rendering.enrollment','Record active payer enrollment for the treating provider.')
  if(!validNpi(s.rendering.npi))add('rendering_npi_invalid','rendering.npi','Enter the rendering provider NPI.')
  if(!validNpi(s.billing.npi))add('billing_npi_invalid','billing.npi','Enter the practice billing NPI.')
  if(!/^\d{9}$/.test(s.billing.taxId))add('tax_id_missing','billing.taxId','Enter the practice federal tax ID.')
  if(!s.billing.address||!s.billing.city||!s.billing.state||!s.billing.postal)add('billing_address_missing','billing.address','Complete the practice billing address.')
  if(!s.billing.sender||!s.billing.contact||!s.billing.phone)add('submitter_missing','billing.sender','Complete the submitter identity and contact.')
  if(!s.rendering.first||!s.rendering.last)add('rendering_name_incomplete','rendering.name','Enter both rendering provider names on the staff record.')
  if(!/^\d{9}[A-Z]$/.test(s.rendering.taxonomy))add('taxonomy_missing','rendering.taxonomy','Enter the rendering provider taxonomy on enrollment.')
  if(!s.patient.dob)add('patient_dob_missing','patient.dob','Enter the patient date of birth.')
  if(s.requiresReferral&&(!s.referring?.last||!s.referring?.first||!validNpi(s.referring.npi)))add('referring_npi_missing','referring','Enter the referring provider name and valid NPI.')
  if(!s.diagnoses.length)add('diagnosis_missing','diagnoses','Record ICD-10 diagnoses on the visit.')
  try {parseIcd10(s.diagnoses.join(','))}catch{add('diagnosis_invalid','diagnoses','Correct the visit ICD-10 diagnosis format.')}
  if(!s.lines.length)add('signed_cpt_required','lines','Record billable CPT minutes on the signed note.')
  if(s.lines.some(l=>l.amountCents<=0))add('fee_missing','lines.amountCents','Enter each line charge or configure the payer fee schedule.')
  if(s.lines.reduce((sum,l)=>sum+l.amountCents,0)!==s.invoiceCents)add('invoice_claim_total_mismatch','lines.amountCents','Claim charges must equal the approved visit invoice total.')
  if(s.lines.some(l=>!l.units||l.units>99||l.modifiers.length>4||l.modifiers.some(m=>!/^[A-Z0-9]{2}$/.test(m))))add('claim_line_invalid','lines','Check units and up to four two-character modifiers.')
  if((s as any).policyCovers===false)add('policy_outside_coverage','policy','The policy does not cover the service date.')
  if((s as any).authorizationExhausted)add('authorization_exhausted','authorization','The attended visit exceeds the authorized visits.')
  if(s.payer.medicare&&s.kx.thresholdCents===null)add('medicare_threshold_missing','medicare.year','Configure this service year’s published Medicare KX threshold.')
  if(s.payer.medicare&&!(s as any).estimatedAllowedCents)add('medicare_allowed_fee_missing','payer.fees','Configure the Medicare allowed fee schedule to track incurred expenses.')
  if(s.kx.required&&!s.medicalNecessity.trim())add('kx_medical_necessity_required','medicalNecessity','The treating clinician must document medical necessity before using KX.')
  if(s.kx.required&&s.lines.some(l=>!l.modifiers.includes('KX')))add('kx_modifier_missing','lines.modifiers','Add KX to the medically necessary services above the threshold.')
  if(s.frequency==='7'&&!s.originalControl)add('original_payer_control_required','originalControl','Enter the original payer claim control number for a replacement.')
  return errors
}
