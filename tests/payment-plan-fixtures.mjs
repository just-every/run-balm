// Only the Stripe HTTP edge is altered: a successful charge whose response is
// lost proves that a later scheduler cannot blindly issue the charge again.
import { fakeProviders } from './fakes/stripe.mjs'

export function paymentPlanEdge() {
  const stripe = fakeProviders()
  let loseNext = false
  return {
    stripe,
    loseNextPaymentResponse() { loseNext = true },
    async handler(request) {
      const charge = request.method === 'POST' && new URL(request.url).pathname === '/v1/payment_intents'
      const response = await stripe.handler(request)
      if (charge && loseNext) {
        loseNext = false
        return Response.json({ error: { message: 'Provider response lost after accepting payment' } }, { status: 503 })
      }
      return response
    },
  }
}

export const installmentTick = async (h, on) => (await h.mf.getWorker()).scheduled({ scheduledTime: Date.parse(on + 'T02:00:00Z'), cron: '* * * * *' })
export const recordedAuthorization = (name = 'Ava Ng') => ({ authorized: true, authorizedBy: name, authorizedOn: new Date().toISOString().slice(0, 10), evidence: 'Patient signed the exact amount, monthly dates and stop terms; agreement retained in the patient file.' })
