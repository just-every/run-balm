import {h,panel} from './shared'
export function injuryPanel(s:any){
 const cases=s.insurance.injuryCases;if(!cases?.length)return ''
 return `<section id="injury-cases">${panel('Workers’ comp, auto and injury cases','<p>Owner-reviewed carrier instructions and report originals. Report delivery is unavailable: a BAA-backed carrier attachment channel must be configured and proven before any injury claim is sent.</p>'+cases.map((c:any)=>`<article class="entry"><h3>${h(c.patient)} · ${h(c.kind.replaceAll('_',' '))}</h3><p>${h(c.payer)} · claim ${h(c.claim_number)} · adjuster ${h(c.adjuster)} (${h(c.adjuster_email)}) · employer or attorney ${h(c.employer_attorney)}</p><dl><dt>Billing</dt><dd>${h(c.billing_requirements)}</dd><dt>Authorization</dt><dd>${h(c.authorization_requirements)}</dd><dt>Required reports</dt><dd>${h(c.report_requirements)}</dd><dt>Instruction source</dt><dd>${h(c.source)}</dd></dl></article>`).join(''))}</section>`
}
