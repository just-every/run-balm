import { hostDateAt } from '../availability/timezone'
import { documentTypes } from '../chart-history/documents'
import { historyTypes } from '../chart-history/search'
import { attachmentInput } from '../messages/attachments'
import { field, form, h, hidden, panel, select, textarea, usDate, zoneOf } from './shared'
import { assignForm, episodeField, episodeLabel } from './episodes'

// Records filed to an episode by themselves; intake and a visit's notes follow their visit.
const filedAlone: Record<string, string> = { referral: 'document', imaging: 'document', order: 'document', signed_plan: 'document', photo: 'document', other: 'document', plan: 'plan', message: 'message', historical_note: 'historical_note' }

export function chartHistoryPanel(s: any, f: any) {
  const history=f.chartHistory
  if (!history) return ''
  const path='/app/clients/'+f.client.id, filters=history.filters, zone=zoneOf(s)
  const search=`<form method="get" action="${h(path)}#chart-history">${field('historyText','Search chart history',filters.historyText,'search','maxlength="200"')}`
    + `<div class="pair">${field('historyFrom','From document date',filters.historyFrom,'date')}${field('historyTo','Through document date',filters.historyTo,'date')}</div>`
    + select('historyType','Document type',[['','All types'],...historyTypes.map(([key,label])=>[key,label] as [string,string])],filters.historyType,'')
    + ((f.episodes ?? []).some((e:any)=>e.id) ? select('historyEpisode','Episode of care',[['','All episodes'],...f.episodes.filter((e:any)=>e.id).map((e:any)=>[e.id,e.title]),['none','Not assigned to an episode']] as [string,string][],filters.historyEpisode,'') : '')
    + '<button type="submit">Search history</button></form>'
  const pager=(n:number,label:string)=>`<a href="${h(path+'?'+new URLSearchParams({...filters,historyPage:String(n)})+'#chart-history')}">${label}</a>`
  const list=history.entries.map((r:any)=>`<article class="entry"><h3>${h(r.title)}</h3><p>${h(historyTypes.find(([key])=>key===r.type)?.[1]??r.type)} · ${h(r.date?usDate(r.date,zone):'Date not recorded')}`
    + `${r.filename?`<br>${h(r.filename)} · ${h(r.byteLength)} bytes${r.filedBy?`<br>Filed by ${h(r.filedBy)}`:''}`:''}<br>${episodeLabel(f,r.episodeId)}</p><a href="${h(r.url)}">${h(r.action)}</a>${r.planId?`<p>Written signature ${h(usDate(r.signatureDate,zone))} · certified ${h(usDate(r.certificationDate,zone))}</p><a href="#plan-${h(r.planId)}">Open matched plan version</a>`:''}${!r.planId&&filedAlone[r.type]&&!f.careAccess?.teamOnly?assignForm(f,filedAlone[r.type],r.id,r.episodeId,path):''}</article>`).join('')
  const upload=form('chart.document.upload',path,hidden('clientId',f.client.id)+episodeField(f)+field('title','Document title','','text','required maxlength="160"')
    + select('documentType','Type of document',documentTypes.map(([key,label])=>[key,label]),'other')
    + field('documentDate','Document date',hostDateAt(new Date(),zone),'date','required')
    + textarea('searchText','Searchable text or description','','maxlength="8000" rows="3"')+attachmentInput
    + '<p class="help">Files and filing details are fixed when added. Enter searchable text for scans and photos; Balm does not extract text from file contents. Adding a signed plan scan here stores the copy; it does not certify a plan of care.</p>','Add chart document')
    .replace('<form method="post"','<form enctype="multipart/form-data" method="post"')
  return panel('Chart history',`<p>Search the clinical history you can read. Uploaded documents are available to every practitioner treating this patient. Dates include both selected days.</p>${search}`
    + `<p class="help">${h(history.total)} matching record${history.total===1?'':'s'} · page ${h(history.page)}</p>${list||'<p class="empty">No matching records.</p>'}`
    + `<nav class="pager" aria-label="Chart history pages">${history.page>1?pager(history.page-1,'Previous records'):''}${history.page*history.pageSize<history.total?pager(history.page+1,'Next records'):''}</nav>`
    // Uploading needs a visit; CHART-013 care-team access alone only reads.
    + (f.careAccess?.teamOnly ? '' : `<details><summary>Attach a chart document</summary>${upload}</details>`),'full','chart-history')
}
