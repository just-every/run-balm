import { hostDateAt } from '../availability/timezone'
import { documentTypes } from '../chart-history/documents'
import { historyTypes } from '../chart-history/search'
import { attachmentInput } from '../messages/attachments'
import { field, form, h, hidden, panel, select, textarea, usDate, zoneOf } from './shared'

export function chartHistoryPanel(s: any, f: any) {
  const history=f.chartHistory
  if (!history) return ''
  const path='/app/clients/'+f.client.id, filters=history.filters, zone=zoneOf(s)
  const search=`<form method="get" action="${h(path)}#chart-history">${field('historyText','Search chart history',filters.historyText,'search','maxlength="200"')}`
    + `<div class="pair">${field('historyFrom','From document date',filters.historyFrom,'date')}${field('historyTo','Through document date',filters.historyTo,'date')}</div>`
    + select('historyType','Document type',[['','All types'],...historyTypes.map(([key,label])=>[key,label] as [string,string])],filters.historyType,'')
    + '<button type="submit">Search history</button></form>'
  const pager=(n:number,label:string)=>`<a href="${h(path+'?'+new URLSearchParams({...filters,historyPage:String(n)})+'#chart-history')}">${label}</a>`
  const list=history.entries.map((r:any)=>`<article class="entry"><h3>${h(r.title)}</h3><p>${h(historyTypes.find(([key])=>key===r.type)?.[1]??r.type)} · ${h(r.date?usDate(r.date,zone):'Date not recorded')}`
    + `${r.filename?`<br>${h(r.filename)} · ${h(r.byteLength)} bytes${r.filedBy?`<br>Filed by ${h(r.filedBy)}`:''}`:''}</p><a href="${h(r.url)}">${h(r.action)}</a></article>`).join('')
  const upload=form('chart.document.upload',path,hidden('clientId',f.client.id)+field('title','Document title','','text','required maxlength="160"')
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
