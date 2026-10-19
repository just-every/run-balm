// Shared real-clinic setup for PORTAL-004's public-door and browser journeys.
// Only Stripe and email requests are faked at their external HTTP edges.
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'

export async function portalLogin(h, email) {
  assert.equal((await h.form('/portal', { email })).status, 200)
  const mail = h.mail.findLast(m => m.to.includes(email) && m.text.includes('/portal/confirm?token='))
  const link = new URL(mail.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0])
  const signedIn = await h.send('/portal/confirm', { token: link.searchParams.get('token') })
  assert.equal(signedIn.status, 303)
  return signedIn.cookie
}

export async function portalBilling(options = {}) {
  const stripe = fakeProviders(), h = await harness({ outbound: stripe.handler, ...options })
  try {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h)
    await h.cmd('settings.save', { clinicName: 'Riverside Therapy', timeZone: 'Australia/Brisbane', taxId: '12-3456789', practiceNpi: '1234567893', address: '100 Main St, Austin TX 78701' })
    await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1245319599' })
    await h.cmd('pay.stripe.connect', { secretKey: 'sk_test_' + 'a'.repeat(24) })
    const patient = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07', email: 'marisol@patient.example' })
    const invoices = []
    const chargeVisit = async hours => {
      const visit = await pastVisit(h, patient.id, priya, service.id, h.owner, hours)
      await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '97110 GP x3', icd10: 'M25.561' }, priya.cookie)
      await h.cmd('appointment.attend', { id: visit }, priya.cookie)
      const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
      await h.cmd('invoice.approve', { id: invoice.id })
      invoices.push(invoice.id)
    }
    await chargeVisit(2)
    const paidLink = await h.cmd('pay.link.create', { clientId: patient.id, purpose: 'balance', delivery: 'shown' })
    const payPath = new URL(paidLink.url).pathname
    const checkout = await h.form(payPath + '?do=pay', { amount: '95.00' })
    assert.equal(checkout.status, 303)
    const session = stripe.complete(checkout.location.split('/').at(-1))
    assert.equal((await h.send(payPath + '?paid=' + session.id)).status, 200)
    await chargeVisit(5)
    const cookie = await portalLogin(h, 'marisol@patient.example')
    return { h, stripe, patient, invoices, cookie }
  } catch (error) { await h.close(); throw error }
}
