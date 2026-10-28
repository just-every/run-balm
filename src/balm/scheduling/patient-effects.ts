import type { Bindings } from '../../auth.server'
import { bookedIntake } from '../domain/intake-requests'
import { advanceOffers, offerFreedSlots, recordDelivery } from '../domain/waitlist'
import { sendVisitChange } from '../mail/changes'
import { sendBooked, sendCanceled, sendIntake, sendOffer } from '../mail-out'

export async function progressWaitlistOffers(env: Bindings) {
  for (const offer of await advanceOffers(env.DB)) await recordDelivery(env.DB,offer.offerId,offer.entryId,'delivery',await sendOffer(env,offer))
}

export async function freedVisitOffers(env: Bindings, ids: string[]) {
  const offers = await offerFreedSlots(env.DB, ids)
  for (const offer of offers) await recordDelivery(env.DB, offer.offerId, offer.entryId, 'delivery', await sendOffer(env, offer))
  return { offered: new Set(offers.map(o => o.offerId)).size, people: offers.length }
}
export async function patientBookedNotice(env: Bindings, booked: {clientId:string;appointmentId:string;startAt:string;token:string}) {
  const ids = [booked.appointmentId]
  const intake = await bookedIntake(env.DB, booked.clientId, booked.appointmentId, booked.startAt, ids)
  return intake === 'ask' ? sendIntake(env, booked.clientId, booked.token, booked.startAt, undefined, ids) : sendBooked(env, booked.clientId, booked.startAt, 1, ids)
}
export async function patientChangedNotice(env: Bindings, id: string, kind: 'moved' | 'cancelled') {
  if (kind === 'moved') return sendVisitChange(env, [id], 'moved')
  const mail = await sendCanceled(env, [id])
  await freedVisitOffers(env, [id])
  return mail
}
