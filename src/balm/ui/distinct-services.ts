import { field, h, select, textarea } from './shared'
import type { DistinctService } from '../codesets'
/** This form records a clinician's own rationale; nothing here applies a billing modifier. */
export function distinctServiceFields(items:DistinctService[]=[]) {
 return `<fieldset data-distinct-services><legend>Distinct services, when applicable</legend><p class="help">Record only services that were clinically distinct at this visit. The exact rationale is signed with the note. An NCCI edit must permit a modifier before billing can use one.</p>${Array.from({length:Math.min(20,Math.max(2,items.length+1))},(_,n)=>{
  const a=items[n]
  return `<details${a?' open':''}><summary>Distinct service pair ${n+1}</summary><div class="pair">${field(`distinct_code1_${n}`,'Column-one procedure',a?.code1??'','text','maxlength="5"')}${field(`distinct_code2_${n}`,'Column-two procedure',a?.code2??'','text','maxlength="5"')}</div>${select(`distinct_modifier_${n}`,'Clinically appropriate modifier',[['59','59 · Distinct procedural service'],['XE','XE · Separate encounter'],['XP','XP · Separate practitioner'],['XS','XS · Separate structure'],['XU','XU · Unusual non-overlapping service']],a?.modifier??'59')}${textarea(`distinct_reason_${n}`,'Why the services were distinct',a?.reason??'','maxlength="2000"')}<label class="check"><input type="checkbox" name="distinct_attested_${n}" value="on"${a?.attested?' checked':''}><span>I attest that these services were clinically distinct as described.</span></label></details>`
 }).join('')}</fieldset>`
}
export const distinctServiceSummary=(items:DistinctService[]=[])=>items.length?`<h4>Clinician's distinct-service attestations</h4><ul>${items.map(a=>`<li>${h(a.code1)} / ${h(a.code2)} · ${h(a.modifier)} · ${h(a.reason)}</li>`).join('')}</ul>`:''
