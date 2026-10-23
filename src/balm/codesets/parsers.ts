import { day, insist } from '../domain/model'
import { delimited, lines } from './records'
import { blankRow, normalizeCode, type CodeRow, type ReleaseSpec } from './types'
const procedure = /^[A-Z0-9]{5}$/
function cmsDate(value: string, name: string, empty = false): string | null {
  const raw=value.trim()
  if(empty && (!raw || raw==='*' || raw==='00000000'))return null
  insist(/^\d{8}$/.test(raw),`invalid_${name}_in_cms_file`)
  return day(raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6),name)
}
export async function* icdOrder(chunks: AsyncIterable<string>, spec: ReleaseSpec): AsyncGenerator<CodeRow> {
  for await(const line of lines(chunks)) {
    if(!line.trim())continue
    insist(/^\d{5} [A-Z][A-Z0-9 ]{6} [01] /.test(line),'choose_the_complete_icd10cm_order_file_with_header_flags')
    const code=normalizeCode(line.slice(6,13)),billable=Number(line[14]),description=line.slice(77).trim()
    insist(code.length>=3&&description,'invalid_icd_order_row')
    yield {...blankRow(code,spec.effectiveOn),description,billable}
  }
}
export async function* ptp(chunks: AsyncIterable<string>, spec: ReleaseSpec): AsyncGenerator<CodeRow> {
  let count=0
  for await(const row of delimited(chunks,'\t')) {
    const code=normalizeCode(row[0]),code2=normalizeCode(row[1])
    if(!procedure.test(code)||!procedure.test(code2))continue
    insist(row.length>=6,'ncci_update_requires_complete_ptp_file_not_a_change_report')
    const effectiveOn=cmsDate(row[3],'edit_effective_date')!,deletedOn=cmsDate(row[4],'edit_deletion_date',true),modifier=Number(row[5].trim())
    insist([0,1,9].includes(modifier),'invalid_ncci_modifier_indicator')
    count++;yield {...blankRow(code,effectiveOn),key:code+':'+code2,code2,deletedOn,modifier}
  }
  insist(count>0,'no_practitioner_ptp_rows_in_cms_file')
}
export async function* mue(chunks: AsyncIterable<string>, spec: ReleaseSpec): AsyncGenerator<CodeRow> {
  let count=0
  for await(const row of delimited(chunks)) {
    const code=normalizeCode(row[0]);if(!procedure.test(code)||!/^\d+$/.test(row[1]?.trim()??''))continue
    const maxUnits=Number(row[1]),match=/^([123])(?:\s|$)/.exec(row[2]?.trim()??'')
    insist(match&&maxUnits>=0&&maxUnits<=100000,'invalid_practitioner_mue_row')
    count++;yield {...blankRow(code,spec.effectiveOn),maxUnits,adjudication:Number(match[1])}
  }
  insist(count>0,'no_practitioner_mue_rows_in_cms_file')
}
/** CMS HCPC*_ANWEB fixed-width file, record layout positions are 1-based. */
export async function* hcpcs(chunks: AsyncIterable<string>, spec: ReleaseSpec): AsyncGenerator<CodeRow> {
  let current:CodeRow|null=null,count=0
  for await(const line of lines(chunks)) {
    const code=line.slice(0,5).trim(),record=line[10]
    if(!/^[A-Z]\d{4}$/.test(code))continue // Two-character modifier records are a different CMS record type.
    if(record==='3') {
      if(current){count++;yield current}
      insist(line.length>=293,'truncated_hcpcs_record')
      const added=cmsDate(line.slice(268,276),'hcpcs_added_date',true),termination=cmsDate(line.slice(284,292),'hcpcs_termination_date',true)
      const deletedOn=termination?new Date(Date.parse(termination)+86400000).toISOString().slice(0,10):null
      current={...blankRow(code,added??spec.effectiveOn),description:line.slice(11,91).trim(),billable:1,deletedOn}
    } else if(record==='4') {
      insist(current?.code===code,'hcpcs_continuation_without_initial_record');current.description+=' '+line.slice(11,91).trim()
    }
  }
  if(current){count++;yield current}
  insist(count>0,'no_hcpcs_level_ii_rows_in_cms_file')
}
export type CptMapping = { separator?: string; code: string; description: string; timed: string }
/** The licensee specifies its licensed vendor file's column names. No AMA
 * descriptor or proprietary vendor layout is included in Balm. */
export async function* licensedCpt(chunks: AsyncIterable<string>, spec: ReleaseSpec, mapping:CptMapping): AsyncGenerator<CodeRow> {
  insist(mapping&&mapping.code&&mapping.description&&mapping.timed,'map_code_description_and_timed_columns_from_your_licensed_file')
  let header:string[]|null=null,count=0
  for await(const row of delimited(chunks,mapping.separator??'\t')) {
    if(!header){header=row.map(v=>v.trim());insist([mapping.code,mapping.description,mapping.timed].every(v=>header!.includes(v)),'licensed_cpt_columns_not_found');continue}
    if(row.every(v=>!v.trim()))continue
    const code=normalizeCode(row[header.indexOf(mapping.code)]),description=row[header.indexOf(mapping.description)]?.trim(),timed=row[header.indexOf(mapping.timed)]?.trim()
    insist(procedure.test(code)&&description&&['0','1'].includes(timed),'invalid_licensed_cpt_row_requires_reviewed_timed_0_or_1')
    count++;yield {...blankRow(code,spec.effectiveOn),description,billable:1,timed:Number(timed)}
  }
  insist(count>0,'licensed_cpt_file_is_empty')
}
