import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { harness } from './harness.mjs'

// A hosted demo's app gets only deploy-demo.json's settings, not deploy.json's vars.
const { settings = {} } = JSON.parse(await readFile('deploy-demo.json', 'utf8'))

// The clinic day `days` ahead in the demo's time zone, moved to the next Monday-Thursday (Maya's full days).
function clinicDay(days) {
  const at = new Date(Date.now() + days * 86400_000), part = type => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', [type]: type === 'weekday' ? 'short' : type === 'year' ? 'numeric' : '2-digit' }).format(at)
  if (!['Mon', 'Tue', 'Wed', 'Thu'].includes(part('weekday'))) return clinicDay(days + 1)
  return `${part('year')}-${part('month')}-${part('day')}`
}

test('a demo opens on a lived-in clinic: its drafts are approvable and a booking email is simulated', async () => {
  const h = await harness({ entry: 'tests/demo-worker.ts', auth: { RER_DEMO: '1', MAIL_FROM: '', ...settings } })
  try {
    const s = await h.state()
    assert.equal(s.settings.clinic_name, 'Cedar Grove Physical Therapy')
    assert.deepEqual(new Set(s.appointments.map(a => a.status)), new Set(['attended', 'booked', 'cancelled', 'no_show']))
    assert.ok(s.clients.length > 20 && s.invoices.some(i => i.status === 'approved' && i.payments.length))
    // Seeded preparations pass the same fences a person's approval checks.
    await h.cmd('invoice.approve', { id: s.invoices.find(i => i.status === 'draft').id })
    await h.cmd('reminder.approve', { id: s.drafts.find(d => d.type === 'reminder' && d.status === 'draft').id })
    await h.cmd('intake.publish', { id: 'demo-intake-v2' })
    const ava = s.clients.find(c => c.first_name === 'Ava'), maya = s.staff.find(p => p.name === 'Maya Ellison')
    const booked = await h.cmd('appointment.book', { clientId: ava.id, practitionerId: maya.id, serviceId: 'demo-svc-followup', date: clinicDay(8), time: '09:00' })
    assert.equal(booked.mail, 'sent')
    // A staff invitation is an email to a person too: it completes and nothing is kept.
    await h.cmd('staff.invite', { id: s.staff.find(p => p.name === 'Daniel Okafor').id })
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, 0)
    const page = await h.send('/app', undefined, h.owner)
    assert.equal(page.status, 200)
    assert.ok(!page.text.includes('href="/app/mail"'))
  } finally { await h.close() }
})
