import { inboxReview } from './inbox'
import type { MessageFile, SecureMessage } from '../messages'
import { attachmentInput } from '../messages/attachments'
import { empty, entry, form, h, hidden, panel, result, select, stamp, status, textarea } from './shared'

const emergencyNotice = '<p class="help">This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.</p>'
const written = (body: string) => `<p class="secure-body">${h(body)}</p>`
export function messageAttachments(message: SecureMessage, base: string) {
  return message.attachments?.length ? `<ul>${message.attachments.map(f => `<li><a href="${h(base)}/${h(f.id)}">Download ${h(f.filename)}</a> (${Math.ceil(f.byteLength / 1024)} KB)</li>`).join('')}</ul>` : ''
}
const destinationLabel = (message: SecureMessage) => message.route === 'front_desk' ? 'Front desk' : message.recipientName ?? 'Care team'
function messageEntry(s: any, message: SecureMessage, clinicView: boolean, attachmentBase: string, reply = '') {
  return entry(message.sender === 'patient' ? 'Patient' : message.authorName,
    `<p class="help">${stamp(s, message.sentAt)} · ${h(destinationLabel(message))}${clinicView && !message.automated ? ` · Email notice: ${status(message.notification)}` : ''}</p>${written(message.body)}${messageAttachments(message, attachmentBase)}${reply}`, `message-${message.id}`)
}
const uploadForm = (command: string, path: string, fields: string, button: string) => `<form method="post" enctype="multipart/form-data" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${fields}<button type="submit">${h(button)}</button></form>`

/** Command results contain a private URL only when a person chose "show once". */
export function messageResult(state: any, notice: any) {
  const value = result(notice)
  if (!value?.linkId || !value?.expiresAt) return ''
  if (value.url) return `<div class="notice" role="status"><strong>Private message link, shown once.</strong><p>Give this link only to the patient. It replaces earlier links for this destination.</p><p><a href="${h(value.url)}">${h(value.url)}</a></p></div>`
  if (value.mail === 'suppressed') return '<div class="notice" role="status">The message is saved. Email is suppressed on this install, so the patient got no notice: choose <strong>Show a private link once to give to the patient</strong> to open it for them.</div>'
  return `<div class="notice${value.mail === 'sent' ? '' : ' error'}" role="${value.mail === 'sent' ? 'status' : 'alert'}">${value.mail === 'sent'
    ? 'The patient was emailed a private link. The email contains no clinical content.'
    : 'The message page is saved, but its email notice could not be sent. Check the clinic mail settings, then send a new link or show a private link to the patient.'}</div>`
}

/** The audited MessageFile already contains only this person's destinations. */
export function messagePanel(state: any, file: any, notice?: any) {
  const messages: MessageFile | null | undefined = file.messages
  if (!messages) return ''
  const path = `/app/clients/${file.client.id}`, fields = hidden('clientId', file.client.id)
  const delivery = () => select('delivery', 'Private link delivery', file.client.email
    ? [['email', 'Email a generic notice with a new private link'], ['shown', 'Show a private link once to give to the patient']]
    : [['shown', 'Show a private link once to give to the patient']], file.client.email ? 'email' : 'shown')
  const choices: [string, string][] = messages.recipients.map(r => [r.id, r.name])
  if (state.actor.role === 'owner' || state.actor.staffRole === 'reception') choices.push(['front_desk', 'Front desk — scheduling and billing'])
  const recipient = () => choices.length ? select('recipient', 'Conversation destination', choices, choices[0][0]) : hidden('route', 'practitioner')
  const conversation = messages.messages.map(m => messageEntry(state, m, true, '/api/balm/messages/attachments', m.sender === 'patient'
    ? inboxReview(state, file, m.id) + `<details><summary>Reply in this conversation</summary>${uploadForm('message.send', path, fields + hidden('replyTo', m.id) + textarea('body', 'Reply to the patient', '', 'required maxlength="10000" rows="4"') + attachmentInput + delivery(), 'Send reply')}</details>` : '')).join('') || empty('No secure messages yet.')
  const live = messages.access.filter(a => a.active)
  const access = live.length ? live.map(l => `<p class="help">${l.route === 'front_desk' ? 'Front desk' : h(messages.recipients.find(r => r.id === l.practitionerId)?.name ?? 'Care team')} private link expires ${stamp(state, l.expiresAt)}. ${l.openedAt ? `Last opened ${stamp(state, l.openedAt)}.` : 'Not opened yet.'} Notice: ${status(l.deliveryState)}.</p>`).join('')
    + form('message.revoke', path, fields, 'Revoke patient links for my conversations', true) : '<p class="help">There is no active patient message link.</p>'
  const compose = uploadForm('message.send', path, fields + recipient() + textarea('body', 'Message to the patient', '', 'required maxlength="10000" rows="5"') + attachmentInput + delivery()
    + '<p class="help">Messages and attachments stay in this secure conversation. Email carries a generic notice. Sending replaces earlier links for the selected destination.</p>', 'Send secure message')
  const link = `<details><summary>Give the patient a new private message link</summary>${form('message.link', path, fields + recipient() + delivery()
    + '<p class="help">The link opens only the selected conversation and expires after 7 days. Other destinations keep their own links.</p>', 'Create a new private link', true)}</details>`
  return panel('Secure messages', messageResult(state, notice) + emergencyNotice + conversation + compose + access + link, 'full', 'messages')
}

export type PatientMessageData = {
  token: string; clinic: { clinic_name: string; time_zone: string }; expiresAt: string; route: string
  messages: Omit<SecureMessage, 'notification'>[]; error?: string; notice?: string; typed?: { body?: string }
}
export function patientMessagePage(data: PatientMessageData) {
  const state = { settings: data.clinic }, path = `/messages/${encodeURIComponent(data.token)}`
  const messages = data.messages.map(m => messageEntry(state, m as SecureMessage, false, path + '/attachments')).join('') || empty('No messages yet. You can write to the clinic below.')
  return `<h1>Secure messages</h1><p>Your private conversation with ${h(data.clinic.clinic_name)} · ${data.route === 'front_desk' ? 'Front desk for scheduling and billing' : 'Your practitioner'}. Use your patient portal to choose another recipient.</p>${emergencyNotice}`
    + (data.error ? `<div class="notice error" role="alert">${h(data.error)}</div>` : '')
    + (data.notice ? `<div class="notice" role="status">${h(data.notice)}</div>` : '')
    + panel('Conversation', messages + `<form method="post" enctype="multipart/form-data" action="${h(path)}">${textarea('body', 'Your message to the clinic', data.typed?.body ?? '', 'required maxlength="10000" rows="5"')}${attachmentInput}<button type="submit">Send message</button></form>`)
    + `<p class="help">Keep this link private. It expires ${stamp(state, data.expiresAt)}. When the clinic replies, use the newest link they send you. <a href="/portal">Sign in to your patient portal</a> to see all your conversations.</p>`
}
