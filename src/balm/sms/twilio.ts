// Twilio's Programmable Messaging API (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource):
// one form-encoded POST per message with the account's SID and auth token.
// TWILIO_FROM is a 10DLC number (+1…) or a Messaging Service SID (MG…).
import { DomainError } from '../domain/model'
import type { SmsMessage, SmsSender } from './index'

export function twilioSender(config: { accountSid: string; authToken: string; from: string }): SmsSender {
  return {
    async send(message: SmsMessage) {
      const body = new URLSearchParams({ To: message.to, Body: message.body, ...(config.from.startsWith('MG') ? { MessagingServiceSid: config.from } : { From: config.from }) })
      let response: Response
      try {
        response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
          method: 'POST', body, headers: { authorization: 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`), 'content-type': 'application/x-www-form-urlencoded' },
        })
      } catch {
        throw new DomainError('Balm could not reach Twilio; try again in a minute', 409)
      }
      const value = await response.json().catch(() => ({})) as { sid?: string; status?: string; message?: string; code?: number }
      if (!response.ok || !value.sid) throw new DomainError(`Twilio refused the text: ${value.message ?? `HTTP ${response.status}`}`, 409)
      return { id: value.sid, status: String(value.status ?? 'queued') }
    },
  }
}
