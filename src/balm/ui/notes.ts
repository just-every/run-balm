// Treatment notes on a client file: start from the visit's template, draft with
// the scribe, edit the draft, review and sign, then add signed addenda.
import { codes } from '../charting/cpt'
import { disciplines, template, templates } from '../charting/templates'
import { clinician, empty, entry, field, form, h, hidden, panel, stamp, status, textarea, usDate, when, zoneOf } from './shared'

const CHARGE_ROWS = 6
const templateChoices = (current: string) => `<option value="">Free-text note</option>${Object.entries(disciplines).map(([d, label]) => `<optgroup label="${h(label)}">${templates.filter(t => t.discipline === d).map(t => `<option value="${h(t.key)}"${t.key === current ? ' selected' : ''}>${h(t.title)}</option>`).join('')}</optgroup>`).join('')}`
export const templateSelect = (name: string, label: string, current: string) => `<label>${h(label)}<select name="${h(name)}">${templateChoices(current)}</select></label>`

function chargeRows(charges: any[]) {
  const options = (value: string) => `<option value="">No code</option>${codes.map(c => `<option value="${h(c.code)}"${c.code === value ? ' selected' : ''}>${h(c.code)} ${h(c.description)}${c.timed ? '' : ' (untimed)'}</option>`).join('')}`
  return `<fieldset class="charges"><legend>CPT codes and minutes</legend><p class="help">Timed codes bill by the CMS 8-minute rule on their total minutes; untimed codes bill one unit.</p>${Array.from({ length: CHARGE_ROWS }, (_, n) => `<div class="pair"><label>Code<select name="charge_code_${n}">${options(charges[n]?.code ?? '')}</select></label><label>Minutes<input name="charge_minutes_${n}" type="number" min="0" max="480" step="1" value="${h(charges[n]?.minutes || '')}"></label></div>`).join('')}</fieldset>`
}

function sectionFields(t: any, values: Record<string, string>) {
  return t.sections.map((s: any) => `<label>${h(s.label)}${s.required ? '' : ' <span class="help">(optional)</span>'}<textarea name="section_${h(s.id)}" maxlength="8000" placeholder="${h(s.help)}">${h(values[s.id] ?? '')}</textarea></label>`).join('')
}

/** The billed units table with its 8-minute rule line. */
export function billing(b: any) {
  if (!b?.lines?.length) return ''
  return `<div class="table"><table class="units"><thead><tr><th>CPT</th><th>Procedure</th><th>Minutes</th><th>Units</th></tr></thead><tbody>${b.lines.map((l: any) => `<tr><td>${h(l.code)}</td><td>${h(l.description)}</td><td>${l.timed ? h(l.minutes) : 'untimed'}</td><td>${h(l.units)}</td></tr>`).join('')}</tbody></table></div>`
    + `<p class="billed"><strong>${b.timedMinutes ? `8-minute rule · ${b.timedMinutes} timed min · ${b.timedUnits} ${b.timedUnits === 1 ? 'unit' : 'units'}` : 'No timed minutes'}</strong> · ${b.units} billed ${b.units === 1 ? 'unit' : 'units'} in all</p>`
}

function content(r: any) {
  if (!r.sections) return `<div class="note">${h(r.body)}</div>`
  return `<dl class="answers">${r.sections.map((s: any) => `<dt>${h(s.label)}</dt><dd>${s.text ? h(s.text) : '<span class="help">Not written</span>'}</dd>`).join('')}</dl>`
}

const me = (s: any) => (s.staff ?? []).find((x: any) => x.id === s.actor.staffId) ?? {}

function noteEntry(s: any, f: any, n: any) {
  const path = `/app/clients/${f.client.id}`, [latest, ...older] = n.revisions, visit = f.appointments.find((a: any) => a.id === n.appointmentId)
  const t = template(n.template), values = Object.fromEntries((latest.sections ?? []).map((x: any) => [x.id, x.text]))
  const head = `<p>${n.status === 'signed' ? status('Signed') : status('Draft · not signed')} ${visit ? `${h(visit.service)} · ${when(s, visit.start_at)}` : ''}<br><span class="help">By ${h(n.authorName)} · started ${stamp(s, n.createdAt)} · revision ${latest.number}</span></p>`
  const scribe = n.status !== 'signed' && latest.draftedBy === 'scribe' ? `<div class="notice" role="note"><strong>Drafted by the scribe from your dictation.</strong> Review and correct every section and code before you sign. The scribe never signs.${latest.reason.length > 21 ? ` <br>${h(latest.reason)}` : ''}</div>` : ''
  const signature = n.signature ? `<p class="signature">Electronically signed by <strong>${h(n.signature.name)}, ${h(n.signature.credentials)}</strong> · ${stamp(s, n.signature.signedAt)} · revision ${h(n.signature.revision)}<br><span class="help">Locked. Signature digest ${h(String(n.signature.sha256).slice(0, 16))}…</span></p>` : ''
  const addenda = n.addenda.length ? `<h4>Addenda</h4>${n.addenda.map((a: any) => `<div class="note">${h(a.body)}</div><p class="help">Addendum signed by ${h(a.name)}, ${h(a.credentials)} · ${stamp(s, a.writtenAt)}</p>`).join('')}` : ''
  const history = older.length ? `<details><summary>Earlier revisions (${older.length})</summary>${older.map((r: any) => `<p class="help">Revision ${r.number} · ${stamp(s, r.writtenAt)}${r.reason ? ' · ' + h(r.reason) : ''}</p>${content(r)}`).join('')}</details>` : ''
  let actions = ''
  if (n.mine && n.status !== 'signed') {
    const edit = t ? sectionFields(t, values) : textarea('body', 'Note', latest.body, 'required maxlength="20000"')
    actions += `<details><summary>Edit draft</summary>${form('note.amend', path, hidden('id', n.id) + hidden('revision', latest.number) + edit + chargeRows(latest.charges) + field('reason', 'What changed (optional)', '', 'text', 'maxlength="300"'), 'Save draft')}</details>`
    const early = visit && Date.parse(visit.start_at) > Date.now(), canceled = visit?.status === 'cancelled'
    if (canceled) actions += `<p class="help">This visit was canceled, so this draft cannot be signed.</p>`
    else if (early) actions += `<p class="help">You can sign this note once the visit has started (${when(s, visit.start_at)}).</p>`
    else actions += `<details><summary>Review and sign</summary>${form('note.sign', path, hidden('id', n.id) + hidden('revision', latest.number)
      + `<p>You are signing revision ${latest.number} exactly as shown above. Once signed the note is locked; later changes are addenda.</p>`
      + `<div class="pair">${field('signature', 'Type your full name to sign', '', 'text', `required maxlength="160" autocomplete="name" placeholder="${h(me(s).name ?? '')}"`)}${field('credentials', 'Credentials', me(s).credentials ?? '', 'text', 'required maxlength="60" placeholder="PT, DPT"')}</div>`
      + '<label class="check"><input type="checkbox" name="attest" value="on" required><span>I reviewed this note and attest that it is accurate and complete.</span></label>', 'Sign note')}</details>`
  }
  if (n.mine && n.status === 'signed') actions += `<details><summary>Add an addendum</summary>${form('note.addendum', path, hidden('id', n.id) + textarea('body', 'Addendum', '', 'required maxlength="8000"') + '<p class="help">The signed note stays as it is. The addendum is signed with your name and the time.</p>', 'Sign and add addendum')}</details>`
  return entry(`${n.title}`, head + scribe + content(latest) + billing(n.billing) + signature + addenda + history + actions)
}

/** Goals carried forward from the practitioner's latest signed note on this file. */
const carriedGoals = (f: any) => f.notes.find((n: any) => n.mine && n.status === 'signed' && n.revisions[0].sections?.some((x: any) => x.id === 'goals' && x.text))?.revisions[0].sections.find((x: any) => x.id === 'goals').text ?? ''

function compose(s: any, f: any, ask: any) {
  const path = `/app/clients/${f.client.id}`, mine = f.appointments.filter((a: any) => a.practitioner_id === s.actor.staffId && a.status !== 'cancelled')
  if (!clinician(s) || !mine.length) return ''
  const visit = mine.find((a: any) => a.id === ask?.compose)
  // Today's or the latest visit that has started comes first, then the next one booked.
  const started = mine.filter((a: any) => Date.parse(a.start_at) <= Date.now()), upcoming = mine.filter((a: any) => Date.parse(a.start_at) > Date.now())
  const suggested = visit ?? started[0] ?? upcoming[upcoming.length - 1]
  const visitDate = (a: any) => usDate(a.start_at, zoneOf(s))
  const chosen = visit ? (ask.template ?? visit.note_template ?? '') : ''
  const t = template(chosen)
  const start = `<form method="get" action="${h(path)}"><label>Visit<select name="compose" required>${mine.map((a: any) => `<option value="${h(a.id)}"${a.id === suggested?.id ? ' selected' : ''}>${h(a.service)} · ${h(visitDate(a))} · ${h(a.status)}</option>`).join('')}</select></label>`
    + `${visit ? templateSelect('template', 'Template', chosen) : '<p class="help">The note starts from the template set on the visit’s service; you can choose another next.</p>'}<button type="submit" class="secondary">${visit ? 'Use this template' : 'Start a note'}</button></form>`
  if (!visit) return `<details><summary>Write a note</summary>${start}</details>`
  const scribe = !t ? '' : s.scribe?.ready
    ? `<details open><summary>Draft with the scribe</summary>${form('note.scribe', path, hidden('clientId', f.client.id) + hidden('appointmentId', visit.id) + hidden('template', t.key) + textarea('dictation', 'Dictation or bullet points for this visit', '', 'required maxlength="20000" placeholder="Pt reports... Ther ex 23 min: ... Manual 10 min: ... Plan: ..."') + '<p class="help">The scribe drafts the sections and CPT minutes from what you write here, using this clinic’s own AI model. You review and sign; it never signs.</p>', 'Draft the note')}</details>`
    : `<p class="help">${h(s.scribe?.line ?? 'Add a key to use the scribe.')}${s.actor.role === 'owner' && !s.scribe?.managed ? ' <a href="/app/clinic#scribe">Add it in Clinic</a>.' : ''}</p>`
  const body = t ? sectionFields(t, { goals: carriedGoals(f) }) : textarea('body', 'Treatment note', '', 'required maxlength="20000"')
  const write = form('note.write', path, hidden('clientId', f.client.id) + hidden('appointmentId', visit.id) + hidden('template', t?.key ?? '') + body + chargeRows([]), 'Save draft')
  return `<details open><summary>Write a note: ${h(t?.title ?? 'free text')} for ${h(visit.service)} on ${h(visitDate(visit))}</summary>${start}${scribe}${write}</details>`
}

export function notesPanel(s: any, f: any, ask: any) {
  if (f.notes === null) return panel('Treatment notes', '<p>Treatment notes are readable only by the practitioner who wrote them and the clinic owner.</p>')
  const list = f.notes.map((n: any) => noteEntry(s, f, n)).join('')
  return panel('Treatment notes', (list || empty('No notes you can read yet.')) + compose(s, f, ask), 'full')
}
