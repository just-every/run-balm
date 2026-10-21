import { empty, field, h, panel, stamp, status, when } from './shared'
export function locationPage(s:any,path:string) {
 const l=s.location
 const filter=`<form method="get"><div class="pair">${field('from','From',l.from,'date','required')}${field('to','Through',l.to,'date','required')}</div><button>Show location</button></form>`
 const schedule=l.appointments.map((a:any)=>`<article class="entry"><h3>${h(a.client)}</h3><p>${when(s,a.start_at)} · ${status(a.status)}<br>${h(a.service)} · ${h(a.practitioner)} · ${h(a.room)}</p></article>`).join('')
 return `<h1>${h(l.name)} · ${path.startsWith('/app/reports')?'Reports':'Schedule'}</h1><p>You have read-only access to this location’s schedule and visit counts. Rooms without a location are excluded.</p><div class="grid">${panel('Dates',filter)}${path.startsWith('/app/reports')?panel('Visit counts',Object.entries(l.counts).map(([k,v])=>`<p>${h(k)}: <strong>${h(v)}</strong></p>`).join('')):panel('Visits',schedule||empty('No visits in this date range.'),'full')}</div>`
}
