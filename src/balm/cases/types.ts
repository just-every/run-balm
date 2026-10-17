import type { Data } from '../domain/model'

/** A record the agent used, with the page that shows it. */
export type Citation = { kind: 'referral' | 'policy' | 'eligibility' | 'authorization' | 'visit' | 'note' | 'claim' | 'era' | 'invoice' | 'statement'; label: string; href: string }
export type StageId = 'referral' | 'intake' | 'eligibility' | 'authorization' | 'visits' | 'notes' | 'claim' | 'era' | 'outcome'
/** done: complete; waiting: on someone else or a date; stalled: needs a person; none: does not apply or has not started. */
/** `next` is what a person does to move a stage that waits on the clinic, and where. */
export type Stage = { id: StageId; label: string; state: 'done' | 'waiting' | 'stalled' | 'none'; text: string; cite?: Citation; next?: { text: string; href: string } }
export type StepKind = 'eligibility.check' | 'authorization.request' | 'claim.send' | 'denial.fix' | 'statement.send'
/** One proposed step: what it does, why, the records it rests on, and what it sends. */
export type Step = {
  key: string; kind: StepKind; title: string; why: string; button: string; citations: Citation[]
  sends?: { to: string; subject: string; fixed?: string; attachment?: { noteId: string; label: string } }; wording?: string; draftable: boolean; blocked?: string; digest: string
}
/** Everything one case is computed from, read in one pass. */
export type CaseFacts = {
  referral: Data; client: Data; policy: Data | null; eligibility: Data | null; authorizations: Data[]
  visits: Data[]; notes: Data[]; invoices: Data[]; claims: Data[]; intakeAt: string | null
  balanceCents: number; lastStatementAt: string | null; done: Data[]; drafts: Data[]; today: string; zone: string; clinic: Data
}
