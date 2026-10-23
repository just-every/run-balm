import { day, insist, text, type Data } from '../domain/model'
import { kinds, nextScheduled, type CodeKind, type ReleaseSpec } from './types'
export const sourcePages = {
  icd10:'https://www.cms.gov/medicare/coding-billing/icd-10-codes',
  hcpcs:'https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update',
  ptp:'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits',
  mue:'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits-mues',
  cpt:'https://www.ama-assn.org/practice-management/cpt/cpt-licensing-frequently-asked-questions-faqs',
}
const official=(value:string)=>{const url=new URL(value);insist(url.protocol==='https:'&&url.hostname==='www.cms.gov'&&url.pathname.startsWith('/files/')&&!url.username&&!url.password,'use_a_cms_published_download_link');return url.href}
export function releaseSpec(input:Data):ReleaseSpec {
  const kind=text(input.kind,'code_set',20) as CodeKind;insist(kinds.includes(kind),'unknown_code_set')
  const effectiveOn=day(input.effectiveOn,'release_effective_date'),nextDueOn=nextScheduled(kind,effectiveOn)
  const month=Number(effectiveOn.slice(5,7));insist(effectiveOn.endsWith('-01')&&(kind==='icd10'?[4,10].includes(month):kind==='cpt'?month===1:[1,4,7,10].includes(month)),'use_the_code_sets_scheduled_effective_date')
  const licenseBasis=String(input.licenseBasis??'').trim()
  if(['cpt','ptp','mue'].includes(kind))insist(input.licenseAcknowledged===true&&licenseBasis.length>=8,'record_the_deployments_applicable_ama_cms_license_before_loading')
  const sourcePage=kind==='cpt'?sourcePages.cpt:String(input.sourcePage??sourcePages[kind])
  if(kind!=='cpt')insist(new URL(sourcePage).protocol==='https:'&&new URL(sourcePage).hostname==='www.cms.gov','use_the_official_cms_release_or_archive_page')
  const files=kind==='cpt'?[]:input.files
  insist(Array.isArray(files)&&(kind==='cpt'||files.length>0)&&files.length<=8,'list_every_cms_release_file')
  if(kind==='ptp')insist(files.length===4,'a_complete_practitioner_ptp_release_requires_all_four_parts')
  const year=Number(effectiveOn.slice(0,4)),quarter=Math.floor((month-1)/3)+1,monthName=['january','','','april','','','july','','','october'][month-1]
  for(const f of files){
    const path=String(f.url).toLowerCase()
    const tokens=kind==='icd10'?(month===10?[String(year+1)]:[`april-1-${year}`]):[`${year}q${quarter}`,`${year}-q${quarter}`,`${monthName}-${year}`,`${monthName}-1-${year}`,`${String(month).padStart(2,'0')}-01-${year}`,`${String(month).padStart(2,'0')}01${year}`]
    insist(tokens.some(t=>path.includes(t)),'cms_file_does_not_name_the_selected_effective_release')
  }
  if(kind==='ptp')insist(new Set(files.map((f:Data)=>/f([1-4])\.zip$/i.exec(f.url)?.[1])).size===4&&files.every((f:Data)=>/f[1-4]\.zip$/i.test(f.url)),'provide_practitioner_ptp_parts_f1_through_f4')
  const version=text(input.version,'release_version',100)
  if(kind==='ptp'){const versions=files.map((f:Data)=>/v(\d{2})(\d)r(\d+)/i.exec(f.url));insist(versions.every((v:any)=>v&&v[0]===versions[0]?.[0]),'ptp_parts_must_have_the_same_cms_version');const v=versions[0]!;insist(version.toLowerCase().replace(/\s/g,'')===`${v[1]}.${v[2]}r${v[3]}`,'release_version_must_match_the_cms_ptp_filename')}
  return {kind,version,effectiveOn,nextDueOn,sourcePage,licenseBasis,files:files.map((f:Data)=>({url:official(text(f.url,'cms_file_url',1000)),...(f.sha256?{sha256:text(f.sha256,'published_file_digest',64)}:{})})).sort((a,b)=>a.url.localeCompare(b.url))}
}
/** Verify that every supplied source is actually linked by CMS, including its
 * AMA license interstitial. Download URLs are never accepted from arbitrary hosts. */
export async function verifyCmsListing(spec:ReleaseSpec, fetcher:typeof fetch=fetch) {
  const response=await fetcher(spec.sourcePage,{redirect:'manual'});insist(response.ok,'cms_release_page_unavailable',424)
  const html=await response.text()
  for(const file of spec.files){const url=new URL(file.url);insist(html.includes(url.pathname)||html.includes(encodeURIComponent(url.pathname)),'file_is_not_in_the_cms_published_release_page')}
}
