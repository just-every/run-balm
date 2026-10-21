import { instruments } from '../intake/outcomes'
import { policyForms } from './consents'
import { questionTypes, type BuilderRow } from '../forms'
import { empty, entry, field, form, h, hidden, panel, rows, select, textarea, stamp, status } from './shared'

const typeName = (type: string) => questionTypes.find(([t]) => t === type)?.[1] ?? type
const describe = (q: any) => `<li>${h(q.label)} <span class="help">(${h(typeName(q.type))}${q.required ? ', required' : ''})</span></li>`

function questionRow(q: BuilderRow, i: number, count: number) {
  const button = (edit: string, label: string, disabled = false) => `<button type="submit" name="edit" value="${edit}" class="secondary" formnovalidate${disabled ? ' disabled' : ''}>${h(label)}</button>`
  return `<fieldset class="question" id="q${i}"><legend>Question ${i + 1}</legend>${hidden(`q${i}_id`, q.id)}`
    + `<label>Question<input name="q${i}_label" value="${h(q.label)}" maxlength="300"></label>`
    + `<div class="pair"><label>Answer type<select name="q${i}_type">${questionTypes.map(([t, label]) => `<option value="${t}"${t === q.type ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`
    + `<label class="check"><input type="checkbox" name="q${i}_required" value="on"${q.required ? ' checked' : ''}><span>Patients must answer</span></label></div>`
    + `<div class="row-actions">${button(`up:${i}`, 'Move up', i === 0)}${button(`down:${i}`, 'Move down', i === count - 1)}${button(`remove:${i}`, 'Remove')}</div></fieldset>`
}

/** The form builder: edits stay on this page until "Prepare draft" saves them as a draft to review. */
function builder(title: string, list: BuilderRow[]) {
  // The first submit button is what Enter presses, so it is the one that prepares the draft.
  return `<form method="post" action="/app/action?name=intake.prepare&amp;returnTo=%2Fapp%2Fintake#builder" id="builder">`
    + `<button type="submit" class="trap" tabindex="-1" aria-hidden="true">Prepare draft</button>`
    + field('title', 'Form title', title, 'text', 'required maxlength="120"') + hidden('questionCount', list.length)
    + list.map((q, i) => questionRow(q, i, list.length)).join('')
    + `<p><button type="submit" name="edit" value="add" class="secondary" formnovalidate>Add a question</button></p>`
    + '<p class="help">Changes here are not saved until you prepare the draft. Preparing creates a draft to review; publishing makes it the form new bookings get.</p>'
    + '<button type="submit">Prepare draft</button></form>'
}

/** Balm's own first form comes with every install: it has no publisher or date of its own. */
const published = (s: any, f: any) => f.published_by === 'Balm default' ? 'Balm’s starting form, in use until you publish your own.' : `Published ${stamp(s, f.published_at)} by ${h(f.published_by)}`

export function intakeForms(s: any, notice: any = {}) {
  const [current, ...older] = rows(s, 'forms').filter(f=>!f.service_id&&!f.discipline)
  const packets=rows(s,'forms').filter(f=>f.service_id||f.discipline)
  const packetFields=field('title','Packet title','','text','required maxlength="120"')+select('serviceId','Service (overrides discipline)',[['','All services in the chosen discipline'],...s.services.map((x:any)=>[x.id,x.name])],'','')+select('discipline','Discipline',[['','Clinic default'],['pt','PT'],['ot','OT'],['slp','SLP'],['pediatric','Pediatric']],'','')+select('baseFormId','Start with these form questions',rows(s,'forms').map((f:any)=>[f.id,f.title+' · version '+f.number]),current.id)+Object.entries(instruments).map(([kind,spec])=>`<details><summary>${h(spec.name)}</summary><p>Scoring: ${spec.min}–${spec.max} per item. ${h(spec.direction)}. <a href="${h(spec.source)}">Scoring reference</a></p>${textarea('items_'+kind,spec.name+' item wording (one per line, in standard order)','','rows="5" maxlength="12000"')}<p class="help">Use the item wording your practice is authorized to use. ${kind==='psfs'?'Enter 1–5 patient-specific activities.':'Enter exactly '+spec.count+' items.'} Leave empty to omit this questionnaire.</p></details>`).join('')
  const drafts = rows(s, 'drafts').filter(d => d.type === 'intake').map(d => entry(`${d.payload.title}`, `<p>${status(d.status)} Prepared by ${h(d.prepared_by)} (${h(d.prepared_role)}) ${stamp(s, d.prepared_at)}</p><ol>${d.payload.questions.map(describe).join('')}</ol>`
    + (d.status === 'draft' ? form('intake.publish', '/app/intake', hidden('id', d.id), 'Publish as the new version') : ''))).join('')
  const editing = notice.builder ?? { title: current.title, rows: current.questions }
  return `<h1>Intake form</h1><p>New bookings get a private link to the current version. Every answer keeps the exact version it answered; published versions never change.</p><div class="grid">
    ${panel(`Current: ${current.title} (version ${current.number})`, `<p>${published(s, current)}</p><ol>${current.questions.map(describe).join('')}</ol>`)}
    ${panel('Service and discipline packets', '<p>A service packet takes priority over a discipline packet, which takes priority over the clinic default. Publishing another version never rewrites an earlier response or its score.</p>'+packets.map(f=>entry(f.title+' · version '+f.number,`<p>${h(s.services.find((x:any)=>x.id===f.service_id)?.name??f.discipline)} · ${published(s,f)}</p>`)).join('')+`<details><summary>Prepare a packet or new packet version</summary>${form('intake.packet.prepare','/app/intake',packetFields,'Prepare packet for review')}</details>`,'full') }
    ${panel('Prepare a new version', builder(editing.title, editing.rows), 'full')}
    ${panel('Prepared versions', drafts || empty('No prepared versions. An agent or you can prepare one.'))}
    ${policyForms(s)}
    ${older.length ? panel('Earlier versions', older.map(f => entry(`Version ${f.number}: ${f.title}`, `<p>${published(s, f)}</p>`)).join('')) : ''}</div>`
}
