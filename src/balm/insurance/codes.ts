// Plain summaries checked 2026-10-17 against X12's maintained external lists:
// https://x12.org/codes/claim-adjustment-reason-codes
// https://x12.org/codes/remittance-advice-remark-codes
// This is a small display vocabulary, not a complete or versioned code set.
const carc:Record<string,string>={
  '1':'Applied to the deductible',
  '2':'Patient coinsurance share',
  '3':'Patient copay share',
  '4':'Procedure and modifier do not agree, or a required modifier is absent',
  '16':'Required information is absent or incorrect; read the remark code',
  '18':'Payer identified a duplicate submission',
  '22':'Another insurer may be responsible; review benefit coordination',
  '29':'Payer filing deadline was missed',
  '45':'Charge exceeds the contracted or allowed fee',
  '96':'The payer excludes this charge from coverage',
  '97':'Payment is included in another adjudicated service',
  '197':'Required authorization or advance notification was not supplied',
  '253':'Federal sequestration payment reduction',
}
const rarc:Record<string,string>={
  M15:'The payer bundled this service into a related procedure',
  M59:'Correct the service end date',
  M62:'Correct the treatment authorization identifier',
  M76:'Correct the diagnosis or condition information',
  M77:'Correct the service location code',
  M81:'Use the most specific diagnosis code available',
  N257:'Correct the billing provider identifier',
  N264:'Correct the ordering provider name',
  N265:'Correct the ordering provider identifier',
  N285:'Correct the referring provider name',
  N286:'Correct the referring provider identifier',
  N288:'Correct the rendering provider taxonomy',
  N289:'Correct the rendering provider name',
  N290:'Correct the rendering provider identifier',
  N382:'Correct the patient identifier',
}
export const adjustmentLabel=(group:string,code:string)=>`${group}-${code}: ${carc[code]??'Review this payer adjustment reason in the remittance'}`
export const remarkLabel=(code:string)=>`RARC ${code}: ${rarc[code]??'Review this payer remark in the remittance'}`
/** A denial Balm stored as carc_<code> (CO group, from an 835) in plain words: the reason, what each remark code in its
 * message asks for, the next step, and the payer's codes for small print. */
export function payerReason(code:string,message='') {
  const reason=code.replace(/^carc_/,''),remarks=[...new Set([...message.matchAll(/RARC ([A-Z]+\d+)/g)].map(m=>m[1]))]
  return {reason:carc[reason]??'The payer adjusted this claim; read the remittance for the reason',remarks:remarks.map(r=>rarc[r]??'Review this payer remark in the remittance'),next:denialNextStep(reason),codes:[`CO-${reason}`,...remarks]}
}
export function denialNextStep(code:string) {
  switch(code) {
    case '197':return 'Verify authorization, correct the claim reference and resubmit, or appeal with the approval.'
    case '4':return 'Review the billed modifiers and the payer remarks; check KX when applicable.'
    case '16':return 'Use the payer remark codes to identify the missing information before resubmitting.'
    case '18':return 'Check the earlier claim and payment before sending another claim.'
    case '22':return 'Confirm the primary payer and coordinate coverage before resubmitting.'
    case '29':return 'Review the payer filing deadline and evidence supporting an appeal.'
    default:return 'Review the payer reason and supporting records before correcting or appealing.'
  }
}
