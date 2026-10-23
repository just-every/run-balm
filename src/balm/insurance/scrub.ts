import { validNpi, parseIcd10 } from '../payments/codes'
import type { ClaimSnapshot, ScrubError } from './types'
import { dollars as usd } from '../domain/invoices'

/** Each refusal is named and tied to a field the biller can correct. No claim
 * is marked clean by guessing missing provider, diagnosis or pricing facts. */

export function scrubClaim(s:ClaimSnapshot):ScrubError[] {
  const errors:ScrubError[]=[],add=(code:string,field:string,message:string)=>errors.push({code,field,message})
  for(const message of s.supervisionErrors??[])add('supervision_not_billable','note',message)
  if(!s.attended)add('visit_not_attended','appointment','Mark the visit attended before claiming.')
  if(!s.signedNotes.length)add('signed_note_required','note','Sign the treatment note before claiming.')
  if(!s.payer.unitMethod)add('payer_unit_method_missing','payer.unitMethod',`Choose how ${s.payer.name} counts timed units, in the payer list on the Insurance page.`)
  for(const code of s.belowThresholdCodes??[])add('timed_code_below_threshold',`lines.${code}`,`${code} has fewer than ${s.payer.fixedUnitMinutes} minutes for ${s.payer.name}’s fixed per-unit threshold. Review the signed minutes before billing.`)
  if(!s.rendering.enrolled)add('provider_enrollment_missing','rendering.enrollment',`Record the treating practitioner’s enrollment with ${s.payer.name} under Provider enrollment on the Insurance page.`)
  if(!validNpi(s.rendering.npi))add('rendering_npi_invalid','rendering.npi','Enter the treating practitioner’s 10-digit NPI under Billing identifiers in Clinic.')
  if(!validNpi(s.billing.npi))add('billing_npi_invalid','billing.npi','Enter the practice’s billing NPI in Practice billing details on the Insurance page.')
  if(!/^\d{9}$/.test(s.billing.taxId))add('tax_id_missing','billing.taxId','Enter the practice’s federal tax ID (EIN) in Practice billing details on the Insurance page.')
  if(!s.billing.address||!s.billing.city||!s.billing.state||!s.billing.postal)add('billing_address_missing','billing.address','Complete the billing address in Practice billing details on the Insurance page.')
  if(!s.billing.contact||!s.billing.phone)add('submitter_missing','billing.contact','Enter the billing contact and phone in Practice billing details on the Insurance page.')
  if(s.billing.production&&!s.billing.sender)add('submitter_id_missing','billing.sender','Electronic sending is on: enter the clearinghouse submitter ID in Practice billing details.')
  if(s.billing.production&&!s.payer.receiver)add('receiver_id_missing','payer.receiver',`Electronic sending is on: enter the Interchange receiver ID for ${s.payer.name} in the payer list.`)
  if(!s.rendering.first||!s.rendering.last)add('rendering_name_incomplete','rendering.name',`Claims need the treating practitioner’s first and last name, but the staff record says “${[s.rendering.first,s.rendering.last].filter(Boolean).join(' ')}”. Edit the name in Clinic → Staff, then check the claim again.`)
  if(!/^\d{9}[A-Z]$/.test(s.rendering.taxonomy))add('taxonomy_missing','rendering.taxonomy','Enter the treating practitioner’s taxonomy code under Provider enrollment on the Insurance page.')
  if(!s.patient.dob)add('patient_dob_missing','patient.dob','Enter the patient’s date of birth in their file.')
  if(s.requiresReferral&&(!s.referring?.last||!s.referring?.first||!validNpi(s.referring.npi)))add('referring_npi_missing','referring','Enter the referring provider name and valid NPI.')
  if(!s.diagnoses.length)add('diagnosis_missing','diagnoses','Record ICD-10 diagnoses on the visit.')
  try {parseIcd10(s.diagnoses.join(','))}catch{add('diagnosis_invalid','diagnoses','Correct the visit ICD-10 diagnosis format.')}
  if(!s.lines.length)add('signed_cpt_required','lines','Record billable CPT minutes on the signed note.')
  if(s.lines.some(l=>l.amountCents<=0))add('fee_missing','payer.fees',`Add ${s.lines.filter(l=>l.amountCents<=0).map(l=>l.code).join(', ')} to ${s.payer.name}’s fee schedule on the Insurance page.`)
  const total=s.lines.reduce((sum,l)=>sum+l.amountCents,0)
  if(!s.cob&&total!==s.invoiceCents)add('invoice_claim_total_mismatch','lines.amountCents',`The claim charges ${usd(total)} from ${s.payer.name}’s fee schedule, but the approved invoice is ${usd(s.invoiceCents)}. They must match. If the fee schedule is wrong, edit ${s.payer.name} on the Insurance page; if the invoice is wrong, void it and prepare it again (it then uses the fee schedule). Then check the claim again.`)
  for(const l of s.lines)if(!l.diagnosisPointers.length||l.diagnosisPointers.length>4||new Set(l.diagnosisPointers).size!==l.diagnosisPointers.length||l.diagnosisPointers.some(p=>!Number.isInteger(p)||p<1||p>s.diagnoses.length))add('diagnosis_pointer_invalid',`lines.${l.code}.diagnosisPointers`,`${l.code}: select one to four diagnoses that are still recorded on this visit. Review the signed note selection and the visit ICD-10 codes.`)
  if(s.lines.some(l=>!l.units||l.units>99||l.modifiers.length>4||l.modifiers.some(m=>!/^[A-Z0-9]{2}$/.test(m))))add('claim_line_invalid','lines','Check units and up to four two-character modifiers.')
  if((s as any).policyCovers===false)add('policy_outside_coverage','policy','The policy does not cover the service date.')
  if(s.authorizationExhausted)add('authorization_exhausted','authorization','The attended visit exceeds the authorized allowance.')
  if(s.authorizationNotCovered)add('authorization_not_covered','authorization','This visit is not covered by the current authorization.')
  if(s.basis?.authorizationCorrection&&!s.authorization)add('new_authorization_required','authorization','Record a new payer authorization after the denial, with a different number covering this visit and its treating practitioner, before resubmitting.')
  if(s.payer.medicare&&s.kx.thresholdCents===null)add('medicare_threshold_missing','medicare.year','Configure this service year’s published Medicare KX threshold.')
  if(s.payer.medicare&&s.lines.some(l=>(s.medicareServices?.[l.code]?.coverage??'covered')==='covered'&&!l.allowedCents))add('medicare_allowed_fee_missing','payer.fees','Configure the Medicare allowed fee schedule to track incurred expenses.')
  if(s.kx.required&&s.lines.some(l=>(s.medicareServices?.[l.code]?.coverage??'covered')==='covered')&&!s.medicalNecessity.trim())add('kx_medical_necessity_required','medicalNecessity','The treating clinician must document medical necessity before using KX.')
  if(s.kx.required&&s.medicalNecessity.trim()&&s.lines.some(l=>(s.medicareServices?.[l.code]?.coverage??'covered')==='covered'&&!l.modifiers.includes('KX')))add('kx_modifier_missing','lines.modifiers','Add KX to the medically necessary services above the threshold.')
  if(s.payer.medicare){
    for(const [code,service] of Object.entries(s.medicareServices??{}))if(service.assistantUnits>s.lines.filter(l=>l.code===code).reduce((t,l)=>t+l.units,0))add('assistant_units_changed','medicareServices','Signed units changed. The clinician must review the assistant unit assessment again.')
    for(const l of s.lines){
      const service=s.medicareServices?.[l.code]
      if(l.modifiers.includes('KX')&&!s.medicalNecessity.trim())add('kx_attestation_missing','medicalNecessity','KX requires the treating clinician’s documented medical necessity.')
      if(service?.abnId&&service.abnOption!==1)add('abn_no_medicare_claim','medicareServices','The beneficiary chose ABN option 2 or 3. Do not submit these services to Medicare.')
      if(l.modifiers.includes('CQ')&&!l.modifiers.includes('GP')||l.modifiers.includes('CO')&&!l.modifiers.includes('GO'))add('assistant_discipline_mismatch','lines.modifiers','CQ requires GP; CO requires GO.')
      if((l.modifiers.includes('CQ')||l.modifiers.includes('CO'))&&!service?.assistantBasis)add('assistant_documentation_required','medicareServices','Record the assistant units and the clinician’s CMS de minimis/final-unit assessment.')
    }
  }
  if(s.frequency==='7' &&!s.originalControl)add('original_payer_control_required','originalControl','Enter the original payer claim control number for a replacement.')
  return errors
}
