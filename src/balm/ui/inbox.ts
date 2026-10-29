import { check, form, h, hidden, stamp, status } from './shared'

/** These controls extend the existing message card and use its native form style. */
export function inboxReview(state: any, file: any, messageId: string) {
  if (!file.inbox) return ''
  const path = `/app/clients/${file.client.id}`, fields = hidden('clientId', file.client.id)
  const saved = file.inbox.preparations.filter((p: any) => p.messageId === messageId)
  return `<details class="inbox-review"><summary>Prepare inbox review</summary><p>Rule-based preparation uses this original conversation only. Approval records a review; sending and all other actions stay separate.</p>`
    + form('inbox.prepare', path, fields + hidden('messageId', messageId), 'Prepare from this message', true)
    + saved.map((p: any) => `<article class="entry" id="inbox-${h(p.id)}"><h4>${h(p.intent === 'records' ? 'Records request' : p.intent === 'review' ? 'Human review required' : p.intent.charAt(0).toUpperCase() + p.intent.slice(1))} ${status(p.approvedAt ? 'Preparation approved' : p.historical ? 'Historical preparation' : p.state)}</h4>
      <p>${h(p.reason)}</p><p><a href="${h(p.citation.href)}">Original incoming portal message</a> · ${stamp(state, p.source.source.sent_at)}</p><blockquote class="secure-body">${h(p.citation.body)}</blockquote>
      <p>Destination: ${p.destination.route === 'front_desk' ? 'Front desk' : 'Existing clinician conversation'}</p>
      ${p.draft ? `<label>Prepared reply<textarea readonly rows="4">${h(p.draft.reply)}</textarea></label><p><strong>Prepared action:</strong> ${h(p.draft.action)}</p>` : '<p>No drafted answer or action.</p>'}
      ${p.approvedAt ? `<p>Preparation approved ${stamp(state, p.approvedAt)}. Nothing was sent or executed.</p>` : p.historical ? '<p>Archive history cannot be approved or executed.</p>' : p.state === 'prepared' ? form('inbox.approve', path, fields + hidden('id', p.id) + hidden('digest', p.digest) + check('confirm', 'I reviewed the original and this exact preparation. This approval sends nothing and performs no action.'), 'Approve preparation') : ''}</article>`).join('')
    + '</details>'
}
