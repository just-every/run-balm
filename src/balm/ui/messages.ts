import type { MessageFile, SecureMessage } from '../messages'
import { empty, entry, form, h, hidden, panel, result, select, stamp, status, textarea } from './shared'

const emergencyNotice = '<p class="help">This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.</p>'
const written = (body: string) => `<p class="secure-body">${h(body)}</p>`

function messageEntry(s: any, message: SecureMessage, clinicView: boolean) {
  return entry(message.sender === 'patient' ? 'Patient' : message.authorName,
    `<p class="help">${stamp(s, message.sentAt)}${clinicView ? ` · Email notice: ${status(message.notification)}` : ''}</p>${written(message.body)}`)
}

/** Command results contain a private URL only when a person chose "show once". */
export function messageResult(state: any, notice: any) {
  const value = result(notice)
  if (!value?.linkId || !value?.expiresAt) return ''
  if (value.url) return `<div class="notice" role="status"><strong>Private message link, shown once.</strong><p>Give this link only to the patient. It replaces every earlier message link.</p><p><a href="${h(value.url)}">${h(value.url)}</a></p></div>`
  if (state.local && value.mail === 'sent') return '<div class="notice" role="status">The message is saved. Balm on this computer sends no email, so the patient got no notice: choose <strong>Show a private link once to give to the patient</strong> to open it for them.</div>'
  return `<div class="notice${value.mail === 'sent' ? '' : ' error'}" role="${value.mail === 'sent' ? 'status' : 'alert'}">${value.mail === 'sent'
    ? 'The patient was emailed a private link. The email contains no clinical content.'
    : 'The message page is saved, but its email notice could not be sent. Check the clinic mail settings, then send a new link or show a private link to the patient.'}</div>`
}

/** Parent attaches the audited MessageFile as file.messages. */
export function messagePanel(state: any, file: any, notice?: any) {
  const messages: MessageFile | null | undefined = file.messages
  if (!messages) return ''
  const path = `/app/clients/${file.client.id}`, fields = hidden('clientId', file.client.id)
  const delivery = () => select('delivery', 'Private link delivery', file.client.email
    ? [['email', 'Email a generic notice with a new private link'], ['shown', 'Show a private link once to give to the patient']]
    : [['shown', 'Show a private link once to give to the patient']], file.client.email ? 'email' : 'shown')
  const conversation = messages.messages.map(m => messageEntry(state, m, true)).join('') || empty('No secure messages yet.')
  const live = messages.access.find(a => a.active)
  const access = live ? `<p class="help">The current private link expires ${stamp(state, live.expiresAt)}. ${live.openedAt ? `Last opened ${stamp(state, live.openedAt)}.` : 'Not opened yet.'} Notice: ${status(live.deliveryState)}.</p>`
    + form('message.revoke', path, fields, 'Revoke patient access', true)
    : '<p class="help">There is no active patient message link.</p>'
  const compose = form('message.send', path, fields + textarea('body', 'Message to the patient', '', 'required maxlength="10000" rows="5"') + delivery()
    + '<p class="help">The message stays on this private page. Only a generic notice and the private link go by email. Sending replaces the patient’s earlier message link; the conversation is retained.</p>', 'Send secure message')
  const link = `<details><summary>${live ? 'Replace the private message link' : 'Give the patient a private message link'}</summary>${form('message.link', path, fields + delivery()
    + '<p class="help">The link opens this patient’s conversation and expires after 7 days. Every earlier message link stops working.</p>', 'Create a new private link', true)}</details>`
  return panel('Secure messages', messageResult(state, notice) + emergencyNotice + conversation + compose + access + link, 'full')
}

export type PatientMessageData = {
  token: string; clinic: { clinic_name: string; time_zone: string }; expiresAt: string
  messages: Omit<SecureMessage, 'notification'>[]; error?: string; notice?: string; typed?: { body?: string }
}

export function patientMessagePage(data: PatientMessageData) {
  const state = { settings: data.clinic }, path = `/messages/${encodeURIComponent(data.token)}`
  const messages = data.messages.map(m => messageEntry(state, m as SecureMessage, false)).join('') || empty('No messages yet. You can write to the clinic below.')
  return `<h1>Secure messages</h1><p>Your private conversation with ${h(data.clinic.clinic_name)}. Only the clinic owner and your treating practitioners can read it.</p>${emergencyNotice}`
    + (data.error ? `<div class="notice error" role="alert">${h(data.error)}</div>` : '')
    + (data.notice ? `<div class="notice" role="status">${h(data.notice)}</div>` : '')
    + panel('Conversation', messages + `<form method="post" action="${h(path)}">${textarea('body', 'Your message to the clinic', data.typed?.body ?? '', 'required maxlength="10000" rows="5"')}<button type="submit">Send message</button></form>`)
    + `<p class="help">Keep this link private. It expires ${stamp(state, data.expiresAt)}. When the clinic replies, use the newest private link they send you. Please contact the clinic if you need a new link.</p>`
}
