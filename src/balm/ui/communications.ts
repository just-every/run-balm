import { empty, field, form, h, hidden, panel, select, stamp, status, textarea } from './shared'

/** Only the authorized search projection reaches this screen. */
export function communicationsPanel(s: any, f: any) {
  const history = f.communications
  if (!history) return ''
  const path = '/app/clients/' + f.client.id
  const choices: [string,string][] = (f.messages?.recipients ?? []).map((r: any) => [r.id,r.name])
  if (s.actor.role === 'owner' || s.actor.staffRole === 'reception') choices.push(['front_desk','Front desk — scheduling and billing'])
  const destination = choices.length ? select('recipient','Call conversation',choices) : hidden('route','practitioner')
  const search = `<form method="get" action="${h(path)}#communications">${field('communicationQuery','Search communication history',history.query,'search','maxlength="200"')}${select('communicationChannel','Channel',[['','All available channels'],['call','Logged calls'],['email','Appointment email metadata'],['secure_message','Secure messages']],history.channel)}<button type="submit">Search history</button></form>`
  const records = history.results.map((r: any) => `<article class="entry"><h3>${h(r.channel === 'call' ? 'Logged call' : r.channel === 'email' ? 'Appointment email' : 'Secure message')} · ${h(r.direction)}</h3><p>${stamp(s,r.at)} · ${h(r.staff)}<br>${status(r.state)}</p><p class="secure-body">${h(r.text)}</p></article>`).join('')
  const call = `<details><summary>Log a call</summary><p>Record work already performed. This sends nothing and makes no recording. Clinical calls belong in the treating practitioner’s conversation; front-desk records are visible to reception.</p>${form('call.log',path,hidden('clientId',f.client.id)+destination+select('direction','Call direction',[['incoming','Incoming'],['outgoing','Outgoing']])+field('occurredAt','Call time in the clinic time zone','','datetime-local','required')+textarea('disposition','Call disposition','','required maxlength="500" rows="3"')+'<p class="help">Your signed-in staff identity and the time of entry are retained. Call records cannot be edited.</p>','Save call record')}</details>`
  return panel('Communication history',search+(history.total === null ? '<p>Search to open the communication records you are authorized to read.</p>' : `<p role="status">${history.total} matching records${history.total > history.limit ? '; newest '+history.limit+' shown' : ''}.</p>`+(records||empty('No matching communication records.')))+call+'<p class="help">Search covers recorded calls, existing appointment email delivery metadata and your authorized secure conversations. A logged call proves no delivery. Provider acceptance proves no receipt or reading. Incoming email, text and fax history are not available here.</p>','full','communications')
}
