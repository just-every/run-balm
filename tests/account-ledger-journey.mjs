import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'
import { installmentTick, recordedAuthorization } from './payment-plan-fixtures.mjs'

export async function accountLedgerJourney() {
  const h = await harness()
  try {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h), desk = await h.staff('Rosa', 'reception')
    const patient = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07', email: 'marisol@patient.example' })
    const other = await h.cmd('client.save', { firstName: 'Jordan', lastName: 'Ng', dateOfBirth: '1985-03-07', email: 'jordan@patient.example' })
    const file = async () => (await h.send('/api/balm/clients/' + patient.id, undefined, desk.cookie)).value
    const zone = (await h.state()).settings.time_zone
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const invoices = []
    const invoice = async hours => {
      const visit = await pastVisit(h, patient.id, priya, service.id, h.owner, hours)
      await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '97110 GP x3', icd10: 'M25.561' }, priya.cookie)
      await h.cmd('appointment.attend', { id: visit }, priya.cookie)
      const prepared = await h.cmd('invoice.prepare', { appointmentId: visit })
      await h.cmd('invoice.approve', { id: prepared.id })
      invoices.push(prepared.id); return prepared.id
    }
    for (const hours of [1, 3, 5]) await invoice(hours)
    await h.cmd('payment.record', { invoiceId: invoices[0], amountCents: 9500, reference: 'Paid-first-visit' }, desk.cookie)
    const proposal = (kind, amount, reference, extra = {}) => ({ clientId: patient.id, kind, amount, reference, reason: 'Reviewed clinic financial correction', occurredOn: today, ...extra })
    const writeoff = proposal('write_off', '20.00', 'Approved-hardship-20', { invoiceId: invoices[1] })
    await h.cmd('pay.entry.prepare', writeoff, priya.cookie, 403)
    const entry = await h.cmd('pay.entry.prepare', writeoff, desk.cookie)
    assert.equal((await file()).billing.ledger.balanceCents, 19000, 'PAY-004 proposal has no ledger effect')
    await h.cmd('pay.entry.approve', { id: entry.id, sha256: entry.sha256, attest: true }, desk.cookie, 403)
    await h.cmd('pay.entry.approve', { id: entry.id, sha256: '0'.repeat(64), attest: true }, h.owner, 409)
    await h.cmd('pay.entry.approve', { id: entry.id, sha256: entry.sha256 }, h.owner, 400)
    const race = await Promise.all([1, 2].map(() => h.send('/api/balm/command', { name: 'pay.entry.approve', input: { id: entry.id, sha256: entry.sha256, attest: true } }, h.owner)))
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409], 'PAY-004 exact proposal posts once under racing approval')
    let f = await file()
    assert.deepEqual([f.billing.ledger.chargesCents, f.billing.ledger.paymentsCents, f.billing.ledger.adjustmentsCents, f.billing.ledger.balanceCents], [28500, 9500, 2000, 17000])
    const posted = f.billing.account.entries.find(e => e.id === entry.id)
    assert.ok(posted.approved_by); assert.equal(posted.sha256, entry.sha256)
    await h.cmd('pay.entry.prepare', proposal('adjustment', '75.01', 'Over-balance', { invoiceId: invoices[1] }), h.owner, 409)
    await h.cmd('pay.entry.prepare', writeoff, h.owner, 409)
    await h.cmd('invoice.void', { id: invoices[1], reason: 'Cannot erase approved adjustment' }, h.owner, 409)
    await h.cmd('payment.record', { invoiceId: invoices[1], amountCents: 7501, reference: 'Too-much-after-writeoff' }, desk.cookie, 409)
    // A stale proposal must not over-reduce an invoice after a payment.
    const stale = await h.cmd('pay.entry.prepare', proposal('adjustment', '10.00', 'Stale-adjustment', { invoiceId: invoices[2] }))
    await h.cmd('payment.record', { invoiceId: invoices[2], amountCents: 9000, reference: 'Changed-before-approval' })
    await h.cmd('pay.entry.approve', { id: stale.id, sha256: stale.sha256, attest: true }, h.owner, 409)
    assert.equal((await file()).billing.ledger.balanceCents, 8000)

    // PAY-004 periodic statements require the recorded opt-in and retain fixed originals.
    const cadence = { clientId: patient.id, everyDays: 30, firstDue: today, ...recordedAuthorization('Marisol Diaz'), authorizedOn: today }
    await h.cmd('pay.statements.save', { ...cadence, authorized: false }, h.owner, 400)
    await h.cmd('pay.statements.save', cadence, priya.cookie, 403)
    const schedule = await h.cmd('pay.statements.save', cadence, desk.cookie)
    const mailBefore = h.mail.length
    await Promise.all([installmentTick(h, today), installmentTick(h, today)])
    f = await file(); assert.equal(f.billing.statements.length, 1)
    const issued = f.billing.statements[0]
    assert.equal(issued.amount_cents, f.billing.ledger.patientBalanceCents)
    const email = h.mail.slice(mailBefore).filter(m => m.to.includes('marisol@patient.example'))
    assert.equal(email.length, 1, 'PAY-004 concurrent ticks send one statement notice')
    assert.ok(email[0].text.includes('/portal')); assert.ok(!email[0].text.includes('Marisol') && !email[0].text.includes('M25.561'))
    assert.equal(f.billing.reminders[0].notices[0].status, 'sent')
    const cookie = await portalLogin(h, 'marisol@patient.example'), foreignCookie = await portalLogin(h, 'jordan@patient.example')
    let portal = await h.send('/portal/home', undefined, cookie)
    assert.ok(portal.text.includes(`/portal/statements/${issued.id}.pdf`))
    const original = await h.send(`/portal/statements/${issued.id}.pdf`, undefined, cookie)
    assert.equal(original.status, 200); assert.match(original.text, /\$80\.00/)
    assert.equal((await h.send(`/portal/statements/${issued.id}.pdf`, undefined, foreignCookie)).status, 404)
    assert.equal((await h.send(`/api/balm/issued-statements/${issued.id}.pdf`, undefined, priya.cookie)).status, 403)
    assert.equal((await h.send(`/api/balm/issued-statements/${issued.id}.pdf`, undefined, desk.cookie)).text, original.text)
    const link = await h.cmd('pay.link.create', { clientId: patient.id, purpose: 'balance', delivery: 'email' }, desk.cookie)
    assert.equal(link.delivered, 'sent')
    const privateLink = await h.cmd('pay.link.create', { clientId: patient.id, purpose: 'balance', delivery: 'shown' }, desk.cookie)
    const privatePath = new URL(privateLink.url).pathname
    assert.equal((await h.send(privatePath + `/statements/${issued.id}.pdf`)).text, original.text)
    const statement = await h.send('/api/balm/statements/' + patient.id + '.pdf', undefined, desk.cookie)
    assert.match(statement.text, /Approved adjustment/); assert.match(statement.text, /\$80\.00/)
    const superbill = await h.send(`/portal/superbills/${invoices[1]}.pdf`, undefined, cookie)
    assert.equal(superbill.status, 409, 'PAY-004 existing superbill still honestly names missing NPI')

    // Money actually received outside Balm becomes credit, allocated once oldest first.
    const post = async input => { const e = await h.cmd('pay.entry.prepare', input, desk.cookie); await h.cmd('pay.entry.approve', { id: e.id, sha256: e.sha256, attest: true }); return e }
    const credit = await post(proposal('credit', '110.00', 'Bank-transfer-110'))
    f = await file()
    assert.deepEqual([f.billing.ledger.balanceCents, f.billing.ledger.creditCents], [-3000, 3000])
    assert.deepEqual(invoices.map(id => f.invoices.find(i => i.id === id).paid_cents), [9500, 7500, 9500], 'PAY-004 credit allocates oldest invoices without a second ledger payment')
    const receipt = await h.send(`/portal/receipts/${credit.id}.pdf`, undefined, cookie)
    assert.equal(receipt.status, 200); assert.match(receipt.text, /External payment receipt/); assert.match(receipt.text, /\$110\.00/)
    assert.equal((await h.send(`/api/balm/receipts/${credit.id}.pdf`, undefined, desk.cookie)).text, receipt.text)
    assert.equal((await h.send(privatePath + `/receipts/${credit.id}.pdf`)).text, receipt.text)
    assert.equal((await h.send(`/portal/receipts/${credit.id}.pdf`, undefined, foreignCookie)).status, 404)
    await h.cmd('pay.entry.prepare', proposal('refund', '30.01', 'Excess-refund', { creditId: credit.id }), h.owner, 409)
    const refund = await post(proposal('refund', '10.00', 'Bank-refund-10', { creditId: credit.id }))
    f = await file(); assert.deepEqual([f.billing.ledger.balanceCents, f.billing.ledger.creditCents], [-2000, 2000])
    const refundReceipt = await h.send(`/portal/receipts/${refund.id}.pdf`, undefined, cookie)
    assert.match(refundReceipt.text, /Recorded external refund/); assert.match(refundReceipt.text, /Balm did not send money or issue a Stripe refund/)
    assert.ok((await h.send('/portal/home', undefined, cookie)).text.includes(`/portal/receipts/${refund.id}.pdf`))
    await invoice(7)
    f = await file(); assert.deepEqual([f.invoices.find(i => i.id === invoices[3]).paid_cents, f.billing.ledger.creditCents, f.billing.ledger.balanceCents], [2000, 0, 7500])
    assert.equal((await h.send(`/portal/receipts/${credit.id}.pdf`, undefined, cookie)).text, receipt.text, 'PAY-004 receipt original is fixed after allocation')
    assert.equal((await h.send(`/portal/statements/${issued.id}.pdf`, undefined, cookie)).text, original.text, 'PAY-004 issued statement survives later payment/refund/charge')
    assert.match((await h.send('/portal/statement.pdf', undefined, cookie)).text, /Recorded external refund/)
    const report = (await h.send(`/api/balm/reports/financial?from=${today}&to=${today}` , undefined, h.owner))
    assert.equal(report.status, 200, report.text)
    assert.equal(report.value.summary.adjustmentsCents, 2000)
    assert.equal(report.value.summary.arCents, 7500)
    assert.equal(report.value.deposits.rows.filter(r => r.source === 'External credit receipt').length, 1)
    const deposit = report.value.deposits.rows.find(r => r.source === 'External credit receipt')
    assert.deepEqual([deposit.receivedCents, deposit.postedCents, deposit.creditCents], [11000, 10000, 0])
    assert.equal(report.value.deposits.rows.find(r => r.refundedCents).receivedCents, -1000)
    assert.equal(report.value.deposits.total.unpostedCents, 0)
    const csv = await h.send(`/api/balm/reports/financial/deposits.csv?from=${today}&to=${today}`, undefined, h.owner)
    assert.equal(csv.status, 200); assert.ok(csv.text.includes('Bank-transfer-110') && csv.text.includes('Bank-refund-10'))
    const cashRows = csv.text.trim().split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replaceAll('""', '"')))
    assert.deepEqual(cashRows.find(r => r[2] === 'Bank-transfer-110').slice(3).map(v => Number(v.replace(/^'/,''))), [110,100,0,0,0,0,0])
    assert.deepEqual(cashRows.find(r => r[2] === 'Bank-refund-10').slice(3).map(v => Number(v.replace(/^'/,''))), [-10,0,0,0,10,0,0])
    const later = new Date(Date.parse(today + 'T12:00:00Z') + 31 * 86400000).toISOString().slice(0, 10)
    await installmentTick(h, later)
    f = await file(); assert.equal(f.billing.statements.length, 2)
    assert.equal(f.billing.statements[0].amount_cents, 7500)
    await h.cmd('pay.reminders.stop', { clientId: patient.id, id: schedule.id, reason: 'Patient asked to stop' })
    await installmentTick(h, new Date(Date.parse(later + 'T12:00:00Z') + 31 * 86400000).toISOString().slice(0, 10))
    assert.equal((await file()).billing.statements.length, 2)
  } finally { await h.close() }
}
