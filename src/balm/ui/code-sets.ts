import { insist, type Data } from '../domain/model'
import { sourcePages } from '../codesets/sources'
import { field, form, h, hidden, panel, result, select, status, textarea } from './shared'

const names: Record<string,string> = { icd10:'ICD-10-CM diagnoses', hcpcs:'HCPCS Level II', cpt:'Licensed CPT', ptp:'NCCI practitioner procedure pairs', mue:'NCCI practitioner unit limits' }
const searchable: [string,string][] = [['icd10','ICD-10-CM'],['hcpcs','HCPCS Level II'],['cpt','Licensed CPT']]
const path='/app/clinic'
const licenseFields=()=>field('licenseBasis','License or applicable CMS/AMA terms reference','','text','required minlength="8" maxlength="2000"')+'<label class="check"><input name="licenseAcknowledged" type="checkbox" value="on" required><span>I confirmed that this deployment may use this data under the applicable license or CMS/AMA terms.</span></label>'

/** Normalize ordinary forms; JSON command inputs retain their structured shape.
 * The multipart reader supplies cptFile as its UTF-8 text, never a local path. */
export function codesetFormInput(input: Data): Data {
  const out: Data={...input}
  if(typeof input.filesText==='string') {
    const lines=input.filesText.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)
    insist(lines.length>0&&lines.length<=8,'List the complete CMS ZIP download links, one per line.')
    out.files=lines.map(url=>{
      let parsed:URL;try{parsed=new URL(url)}catch{insist(false,'Use complete HTTPS CMS download links, one per line.')}
      insist(parsed.protocol==='https:'&&parsed.hostname==='www.cms.gov'&&parsed.pathname.startsWith('/files/zip/')&&!parsed.search&&!parsed.hash,'Use the CMS ZIP download link rather than its license or landing page.')
      return {url:parsed.href}
    })
    delete out.filesText
  }
  if(input.licenseAcknowledged!==undefined)out.licenseAcknowledged=input.licenseAcknowledged===true||input.licenseAcknowledged==='on'
  if(input.cptFile!==undefined){insist(typeof input.cptFile==='string'&&input.cptFile.trim(),'Choose your licensed CPT data file.');out.content=input.cptFile;delete out.cptFile}
  if(input.mappingCode!==undefined||input.mappingDescription!==undefined||input.mappingTimed!==undefined){
    insist(input.mappingSeparator==='tab'||input.mappingSeparator==='comma','Choose whether the licensed file uses tabs or commas.')
    out.mapping={separator:input.mappingSeparator==='comma'?',':'\t',code:String(input.mappingCode??'').trim(),description:String(input.mappingDescription??'').trim(),timed:String(input.mappingTimed??'').trim()}
    for(const key of ['mappingSeparator','mappingCode','mappingDescription','mappingTimed'])delete out[key]
  }
  return out
}

function updateForm(kind:string) {
  const help=kind==='ptp'?'Use all four complete practitioner PTP ZIP parts, f1 through f4, from the same release. Change reports and hospital files cannot replace them.':kind==='icd10'?'Choose the complete Code Descriptions in Tabular Order ZIP, including non-billable headers. Use its October or April effective date.':kind==='mue'?'Choose the complete Practitioner Services MUE table ZIP.':'Choose the complete quarterly Alpha-Numeric HCPCS ZIP.'
  return `<details data-code-update="${h(kind)}"><summary>Update ${h(names[kind])}</summary><p>${h(help)} <a href="${h(sourcePages[kind as keyof typeof sourcePages])}" target="_blank" rel="noreferrer">Open the CMS release page</a>.</p>`+form('codes.update',path,
    hidden('kind',kind)+`<div class="pair">${field('version','Release version','','text',`required maxlength="100"${kind==='ptp'?' placeholder="32.3 r0"':''}`)}${field('effectiveOn','Effective date','','date','required')}</div>`
    +field('sourcePage','CMS release or archive page',sourcePages[kind as keyof typeof sourcePages],'url','required maxlength="1000"')
    +textarea('filesText',kind==='ptp'?'Four CMS ZIP download links (one per line)':'CMS ZIP download link','','required rows="4" maxlength="8000"')
    +`<p class="help">Balm checks the release date and filenames against the CMS page before publishing the tables. Previously loaded versions remain available for earlier service dates.</p>`
    +(['ptp','mue'].includes(kind)?licenseFields():'')
    ,'Check CMS files and update')+'</details>'
}
function cptForm() {
  return `<details data-code-cpt><summary>Import a licensed CPT file</summary><p>This deployment must hold the appropriate AMA license. Balm includes no CPT descriptor dataset. Choose the private UTF-8 CSV or TSV supplied or exported under your license; identify its column headings below.</p><form method="post" enctype="multipart/form-data" action="/app/action?name=codes.cpt.import&amp;returnTo=${encodeURIComponent(path)}">`
    +hidden('kind','cpt')+`<div class="pair">${field('version','Licensed release version','','text','required maxlength="100"')}${field('effectiveOn','Effective date (January 1)','','date','required')}</div>`
    +'<label>Licensed CPT file<input type="file" name="cptFile" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" required></label>'
    +select('mappingSeparator','File separator',[['tab','Tabs (TSV)'],['comma','Commas (CSV)']],'tab')
    +field('mappingCode','Code column heading','Code','text','required maxlength="120"')
    +field('mappingDescription','Descriptor column heading','Descriptor','text','required maxlength="120"')
    +field('mappingTimed','Timed/untimed column heading','Timed','text','required maxlength="120"')
    +'<p class="help">The reviewed timed/untimed column must contain 1 for a timed service and 0 for an untimed service. You may include HCPCS codes with owner-reviewed timing; their descriptions and validity come from the CMS release for the visit date. Keep every CPT row authorized under your license.</p>'+licenseFields()+'<button type="submit">Import licensed CPT file</button></form></details>'
}
function searchResults(r: any) {
  return `<section data-code-results><h3>${h(names[r.kind]??'Code search')} · ${h(r.version)}</h3><p class="help">Service date ${h(r.date)}. <a href="${h(r.source)}">Release source</a>.</p>${r.results?.length?`<ul>${r.results.map((code:any)=>`<li><strong>${h(code.code)}</strong> · ${h(code.description)}${r.kind==='icd10'&&!code.billable?' <strong>Header: choose a billable child below.</strong>':r.kind==='icd10'?' · Billable':''}</li>`).join('')}</ul>`:'<p>No matching codes in this release. Try a more specific code, word or saved synonym.</p>'}</section>`
}
export function codeSetResult(notice:any) {
  const r=result(notice)
  if(!r)return ''
  if(Array.isArray(r.results)&&r.releaseId)return searchResults(r)
  if(r.status==='incomplete'&&r.id)return `<div class="notice" role="status" data-code-update-result>Import in progress: ${h(r.rows)} rows retained. This release is not used for billing.${form('codes.update.continue',path,hidden('resumeId',r.id),'Continue code import')}</div>`
  if(r.duplicate===true&&r.changed===false)return '<div class="notice" role="status" data-code-update-result>Already loaded: the file content is unchanged. No records were added.</div>'
  if(r.changed===true&&typeof r.rows==='number')return `<div class="notice" role="status" data-code-update-result>Code release loaded: ${h(r.rows)} rows.${r.changes?` ${h(r.changes.added)} added, ${h(r.changes.removed)} removed, ${h(r.changes.changed)} changed.`:''}</div>`
  if(r.term&&r.code&&r.kind)return `<div class="notice" role="status" data-code-synonym-result>Search synonym saved for ${h(r.code)}: ${h(r.term)}.</div>`
  return ''
}
export function ownerClinicalCodesPanel(s:any,notice:any={}) {
  if(s.actor?.role!=='owner')return ''
  const items:Array<any>=s.codeSets??[]
  const inventory=items.length?`<ul data-code-status>${items.map(item=>`<li><strong>${h(names[item.kind]??item.kind)}</strong> · ${status(item.missing?'Missing':item.stale?'Update due':'Current')}${item.release?`<br>${h(item.release.version)} · effective ${h(item.release.effective_on)} · ${h(item.release.row_count)} rows · next scheduled ${h(item.release.next_due_on)}`:''}${item.message?`<p class="help">${h(item.message)}</p>`:''}${item.incomplete?.length?item.incomplete.map((job:any)=>`<div class="notice">Incomplete ${h(job.version)} import; not used for billing.${form('codes.update.continue',path,hidden('resumeId',job.id),'Continue code import')}</div>`).join(''):''}</li>`).join('')}</ul>`:'<p>No code-set status has been loaded.</p>'
  const synonym=`<details data-code-synonym><summary>Add a search synonym</summary><p>A synonym helps staff find an official code. It does not make a header billable.</p>${form('codes.synonym.save',path,select('kind','Code set',searchable,'icd10')+field('code','Official code','','text','required maxlength="10"')+field('term','Search word or phrase','','text','required maxlength="200"'),'Save search synonym')}</details>`
  const search=`<details data-code-search-form><summary>Search installed codes</summary>${form('codes.search',path,select('kind','Code set',searchable,'icd10')+field('date','Date of service','','date','required')+field('query','Code, words or synonym','','search','required maxlength="200"'),'Search codes')}</details>`
  return panel('Clinical billing codes',codeSetResult(notice)+inventory+'<p>Code releases are chosen by the visit’s date of service. Update complete CMS releases and keep licensed CPT data private.</p>'+['icd10','hcpcs','ptp','mue'].map(updateForm).join('')+cptForm()+synonym+search,'full','clinical-codes')
}

/** Embed inside the existing clinical note/plan form, never as a nested form. */
export function clinicalCodePicker(s:any,options:{targetName:string;date:string;kind?:'icd10'|'hcpcs'|'cpt';label?:string;dateField?:string}) {
  if(s.actor?.role!=='owner'&&s.actor?.staffRole!=='practitioner')return ''
  const kind=options.kind??'icd10'
  return `<fieldset data-code-picker data-code-kind="${h(kind)}" data-code-target="${h(options.targetName)}" data-code-date="${h(options.date)}" data-code-date-field="${h(options.dateField??'')}"><legend>${h(options.label??'Find a billable diagnosis')}</legend><label>Code, words or synonym<input type="search" data-code-query maxlength="200"></label><button type="button" data-code-find>Find codes</button><p class="help">Uses the release for ${h(options.date)}. Review a code before adding it; diagnosis headers cannot be selected.</p><p role="status" aria-live="polite" data-code-feedback></p><ul data-code-choices></ul></fieldset>`
}

export const codeSetPickerScript=`(() => {
  for (const picker of document.querySelectorAll('[data-code-picker]')) {
    const query=picker.querySelector('[data-code-query]'), feedback=picker.querySelector('[data-code-feedback]'), list=picker.querySelector('[data-code-choices]'), find=picker.querySelector('[data-code-find]')
    let generation=0
    const search=async(prefix=null)=>{
      const value=prefix||query.value.trim();if(!value){feedback.textContent='Enter a code, word or synonym.';return}
      const current=++generation;find.disabled=true;feedback.textContent='Searching the installed release…';list.replaceChildren()
      try {
        const response=await fetch('/api/balm/command',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({name:'codes.search',input:{kind:picker.dataset.codeKind,date:picker.dataset.codeDateField?(picker.closest('form')?.elements.namedItem(picker.dataset.codeDateField)?.value||picker.dataset.codeDate):picker.dataset.codeDate,query:value}})})
        const body=await response.json();if(current!==generation)return
        if(!response.ok)throw new Error(body.error||body.code||'Code search failed. Check your sign-in and try again.')
        const result=body.result;feedback.textContent=result.version+' · '+result.date
        const codes=result.results.filter(c=>!prefix||(c.billable&&c.code.replaceAll('.','').startsWith(prefix.replaceAll('.',''))))
        if(!codes.length){feedback.textContent+=' · No matching billable codes. Refine the search words.';return}
        for(const code of codes){
          const item=document.createElement('li'),button=document.createElement('button'),description=document.createElement('span')
          button.type='button';button.className='secondary';description.textContent=' · '+code.description
          if(picker.dataset.codeKind==='icd10'&&!code.billable){button.textContent=code.code+' · Show billable children';button.addEventListener('click',()=>search(code.code))}
          else{button.textContent='Add '+code.code;button.addEventListener('click',()=>{const target=picker.closest('form')?.elements.namedItem(picker.dataset.codeTarget);if(!target||!('value' in target)){feedback.textContent='Open the note or plan editor before adding this code.';return}if(target.tagName==='SELECT'){if(![...target.options].some(option=>option.value===code.code)){const option=document.createElement('option');option.value=code.code;option.textContent=code.code+' '+code.description;target.append(option)}target.value=code.code}else{const selected=target.value.split(/[,;\\n]+/).map(v=>v.trim()).filter(Boolean);if(!selected.includes(code.code))selected.push(code.code);target.value=selected.join(', ')}target.dispatchEvent(new Event('input',{bubbles:true}));feedback.textContent=code.code+' added. Review and save the draft.'})}
          item.append(button,description);list.append(item)
        }
      }catch(error){if(current===generation)feedback.textContent=error.message||'Code search is unavailable. Try again after checking sign-in.'}
      finally{if(current===generation)find.disabled=false}
    }
    find.addEventListener('click',()=>search())
    query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search()}})
  }
})()`
