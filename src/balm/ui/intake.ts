import { empty, entry, field, form, h, hidden, panel, rows, stamp, status, textarea } from './shared'

const describe = (q: any) => `<li>${h(q.label)} <span class="help">(${h(q.type)}${q.required ? ', required' : ''})</span></li>`

export function intakeForms(s: any) {
  const [current, ...older] = rows(s, 'forms')
  const drafts = rows(s, 'drafts').filter(d => d.type === 'intake').map(d => entry(`${d.payload.title}`, `<p>${status(d.status)} Prepared by ${h(d.prepared_by)} (${h(d.prepared_role)}) ${stamp(d.prepared_at)}</p><ol>${d.payload.questions.map(describe).join('')}</ol>`
    + (d.status === 'draft' ? form('intake.publish', '/app/intake', hidden('id', d.id), 'Publish as the new version') : ''))).join('')
  const example = JSON.stringify(current.questions, null, 1)
  return `<h1>Intake form</h1><p>New bookings get a private link to the current version. Every answer keeps the exact version it answered; published versions never change.</p><div class="grid">
    ${panel(`Current: ${current.title} (version ${current.number})`, `<p>Published ${stamp(current.published_at)} by ${h(current.published_by)}</p><ol>${current.questions.map(describe).join('')}</ol>`)}
    ${panel('Prepare a new version', form('intake.prepare', '/app/intake', field('title', 'Form title', current.title, 'text', 'required maxlength="120"') + textarea('questions', 'Questions (JSON)', example, 'required spellcheck="false"') + '<p class="help">Each question has an id (lowercase), a label, a type (short, long, yes or date) and required (true or false). Preparing creates a draft to review; publishing makes it current.</p>', 'Prepare draft'))}
    ${panel('Prepared versions', drafts || empty('No prepared versions. An agent or you can prepare one.'))}
    ${older.length ? panel('Earlier versions', older.map(f => entry(`Version ${f.number}: ${f.title}`, `<p>Published ${stamp(f.published_at)} by ${h(f.published_by)}</p>`)).join('')) : ''}</div>`
}
