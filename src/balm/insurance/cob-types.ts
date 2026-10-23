import type { ClaimSnapshot } from './types'
export type CobAdjustment={group:string;reason:string;amountCents:number;quantity?:number}
export type CobLine={code:string;modifiers:string[];units:number|null;chargeCents:number;paidCents:number;adjustments:CobAdjustment[];adjudicatedOn:string;reference?:string}
export type CobPrior={policyId:string;priority:number;payer:ClaimSnapshot['payer'];subscriber:ClaimSnapshot['subscriber'];paidCents:number;payerControl:string;lines:CobLine[];adjustments:CobAdjustment[];sourceId:string;sourceKind:'835'|'paper_eob'}
export type CobFacts={priority:number;prior:CobPrior[];primaryUnits:{code:string;units:number}[]}
