export const kinds = ['icd10','hcpcs','cpt','ptp','mue'] as const
export type CodeKind = typeof kinds[number]
export type CodeRow = { key: string; code: string; description: string; billable: number | null; code2: string | null; effectiveOn: string; deletedOn: string | null; modifier: number | null; maxUnits: number | null; adjudication: number | null; timed: number | null }
export type SourceFile = { url: string; sha256?: string; filenamePattern?: string }
export type ReleaseSpec = { kind: CodeKind; version: string; effectiveOn: string; nextDueOn: string; sourcePage: string; files: SourceFile[]; licenseBasis: string }
export const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase().replaceAll('.', '')
export const shownCode = (code: string) => /^[A-Z]\d/.test(code) && code.length > 3 ? code.slice(0,3)+'.'+code.slice(3) : code
export const blankRow = (code: string, effectiveOn: string): CodeRow => ({ key: code, code, description: '', billable: null, code2: null, effectiveOn, deletedOn: null, modifier: null, maxUnits: null, adjudication: null, timed: null })
export function nextScheduled(kind: CodeKind, effective: string) {
  const [year,month] = effective.split('-').map(Number)
  if (kind === 'cpt') return `${year+1}-01-01`
  if (kind === 'icd10') return month < 10 ? `${year}-10-01` : `${year+1}-04-01`
  const next = new Date(Date.UTC(year,month+2,1)); return next.toISOString().slice(0,10)
}
