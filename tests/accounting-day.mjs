import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { clinic, pastVisit } from './clinic.mjs'

export const accountingDay = '2026-10-20'
export const accountingNow = Date.parse('2026-10-20T02:00:00.000Z')

export async function accountingDayFixture(h, stripe) {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya Shah', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
  await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1234567893' })
  await h.cmd('insurance.settings.save', { billingNpi: '1234567893', taxId: '123456789', address: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', senderId: 'BALMTEST', contactName: 'Jordan Clinic', contactPhone: '5125550100' })
  const payer = await h.cmd('insurance.payer.save', { name: 'Aetna', payerId: '60054', receiverId: 'AETNA', unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
  await h.cmd('insurance.enrollment.save', { payerId: payer.id, practitionerId: priya.id, taxonomy: '225100000X', active: true })
  const client = await h.cmd('client.save', { firstName: 'Maya', lastName: 'Lee', dateOfBirth: '1988-04-02' })
  const policy = await h.cmd('insurance.policy.save', { clientId: client.id, payerId: payer.id, memberId: 'synthetic-balm-1', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', startsOn: '2026-01-01', endsOn: '2026-12-31' })
  const visit = await pastVisit(h, client.id, priya, service.id)
  await h.cmd('appointment.attend', { id: visit })
  const note = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'Synthetic therapy visit.', charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 15 }] }, priya.cookie)
  await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, priya.cookie)
  await h.cmd('pay.codes.save', { appointmentId: visit, icd10: 'M25.561' })
  const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
  await h.cmd('invoice.approve', { id: invoice.id })
  const claim = await h.cmd('insurance.claim.prepare', { appointmentId: visit, policyId: policy.id })
  const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
  await h.cmd('insurance.batch.submit', { id: batch.id })
  const fixture = async name => (await readFile(new URL('./fixtures/insurance/' + name, import.meta.url), 'utf8')).replaceAll('{{CLAIM}}', claim.id)
  await h.cmd('insurance.acknowledgment.import', { payerId: payer.id, x12: await fixture('277CA.x12') })
  await h.cmd('insurance.remittance.import', { payerId: payer.id, x12: await fixture('835-paid.x12') })
  await h.cmd('pay.stripe.connect', { secretKey: 'synthetic-balm-1' })
  const link = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'card', delivery: 'shown' }), path = new URL(link.url).pathname
  const session = (await h.form(path + '?do=card', { consent: 'on' })).location.split('/').pop()
  stripe.complete(session)
  assert.equal((await h.send(path + '?setup=' + session)).status, 200)
  await h.cmd('pay.invoice.charge', { invoiceId: invoice.id })
  const cashClient = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-03-04' })
  const cashVisit = await pastVisit(h, cashClient.id, priya, service.id, h.owner, 4)
  await h.cmd('appointment.attend', { id: cashVisit })
  const cashInvoice = await h.cmd('invoice.prepare', { appointmentId: cashVisit })
  await h.cmd('invoice.approve', { id: cashInvoice.id })
  await h.cmd('payment.record', { invoiceId: cashInvoice.id, amountCents: 2000, reference: 'synthetic-balm-2', paymentMethod: 'cash' })
  const payment = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.billing.payments.find(p => p.status === 'succeeded')
  const refund = await h.cmd('pay.refund.prepare', { clientId: client.id, paymentId: payment.id, amount: '5.00', reason: 'Synthetic accounting refund' })
  await h.cmd('pay.refund.approve', { id: refund.id, sha256: refund.sha256, attest: true })
  await h.cmd('finance.source.record', { clientId: client.id, kind: 'payout', amountCents: 970, feeCents: 30, occurredOn: accountingDay, reference: 'synthetic-balm-3', sourceReference: 'synthetic-balm-4', evidence: 'Synthetic allocated processor settlement original, net of refund.', confirm: true })
  return { priya, client, cashClient, invoice, cashInvoice, payment }
}
