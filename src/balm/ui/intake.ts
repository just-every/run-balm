import { questionTypes, type BuilderRow } from '../forms'
import { empty, entry, field, form, h, hidden, panel, rows, stamp, status } from './shared'

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

export function intakeForms(s: any, notice: any = {}) {
  const [current, ...older] = rows(s, 'forms')
  const drafts = rows(s, 'drafts').filter(d => d.type === 'intake').map(d => entry(`${d.payload.title}`, `<p>${status(d.status)} Prepared by ${h(d.prepared_by)} (${h(d.prepared_role)}) ${stamp(s, d.prepared_at)}</p><ol>${d.payload.questions.map(describe).join('')}</ol>`
    + (d.status === 'draft' ? form('intake.publish', '/app/intake', hidden('id', d.id), 'Publish as the new version') : ''))).join('')
  const editing = notice.builder ?? { title: current.title, rows: current.questions }
  return `<h1>Intake form</h1><p>New bookings get a private link to the current version. Every answer keeps the exact version it answered; published versions never change.</p><div class="grid">
    ${panel(`Current: ${current.title} (version ${current.number})`, `<p>Published ${stamp(s, current.published_at)} by ${h(current.published_by)}</p><ol>${current.questions.map(describe).join('')}</ol>`)}
    ${panel('Prepare a new version', builder(editing.title, editing.rows), 'full')}
    ${panel('Prepared versions', drafts || empty('No prepared versions. An agent or you can prepare one.'))}
    ${older.length ? panel('Earlier versions', older.map(f => entry(`Version ${f.number}: ${f.title}`, `<p>Published ${stamp(s, f.published_at)} by ${h(f.published_by)}</p>`)).join('')) : ''}</div>`
}
