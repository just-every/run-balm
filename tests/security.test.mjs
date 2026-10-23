import { test } from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import { harness } from './harness.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { assertPrivateStorage, edgeAddress, effects, portalToken, publicRequest, securityClinic, untilLimited } from './security-clinic.mjs'
import { portalLogin } from './portal-billing.mjs'

test('SEC-002: booking origin and atomic pending cap refuse without writes; intake is hashed, private and one use', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    const { starts, booking } = await securityClinic(h)
    const initial = await effects(h)
    assert.equal((await publicRequest(h, '/book', booking(starts[0]), { headers: { origin: 'https://foreign.example' } })).status, 403)
    assert.deepEqual(await effects(h), initial)

    const accepted = []
    for (const start of starts.slice(0, 20)) {
      const result = await publicRequest(h, '/book', booking(start))
      if (result.status === 429) break
      assert.equal(result.status, 303)
      accepted.push(result)
    }
    assert.ok(accepted.length > 0 && accepted.length < 20, 'pending online bookings are bounded')
    const capped = await effects(h)
    const capRefusal = await publicRequest(h, '/book', booking(starts[20]))
    assert.equal(capRefusal.status, 429)
    assert.ok(!capRefusal.text.includes('Maya') && !capRefusal.text.includes('maya@patient.example'), 'cap refusals echo no patient details')
    assert.deepEqual(await effects(h), capped, 'cap refusal creates no patient, appointment, intake, audit or email')

    const appointments = (await h.db.prepare('SELECT * FROM bm_appointments ORDER BY start_at').all()).results
    assert.equal(appointments.length, accepted.length)
    // Free exactly one place, then compete for it using different open times.
    await h.cmd('appointment.cancel', { id: appointments.at(-1).id, reason: 'Patient changed plans' })
    const beforeRace = await effects(h)
    const race = await Promise.all(starts.slice(21, 24).map(start => publicRequest(h, '/book', booking(start))))
    assert.equal(race.filter(r => r.status === 303).length, 1)
    assert.ok(race.every(r => [303, 409, 429].includes(r.status)))
    const afterRace = await effects(h)
    assert.equal(afterRace.bm_appointments, beforeRace.bm_appointments + 1)
    assert.equal(afterRace.bm_clients, beforeRace.bm_clients)
    assert.equal(afterRace.mail, beforeRace.mail + 1, 'only the winning visit sends mail')

    const intakePath = accepted[0].location.split('?')[0]
    const token = intakePath.split('/').at(-1)
    const page = await publicRequest(h, intakePath)
    assert.equal(page.status, 200)
    const answers = {
      formId: 'intake-v1', q_reason: 'Private clinical intake answer', q_emergency: 'Sam Lee (312) 555-0101', q_consent: 'yes',
      consentVersion: page.text.match(/name="consentVersion" value="([^"]+)"/)[1],
      consentAccepted: 'on', signerName: 'Maya Lee', signerRelationship: 'patient', signatureTyped: 'Maya Lee',
    }
    const beforeCross = await effects(h)
    assert.equal((await publicRequest(h, intakePath, answers, { headers: { origin: 'https://foreign.example' } })).status, 403)
    assert.deepEqual(await effects(h), beforeCross)
    assert.equal((await publicRequest(h, intakePath, answers)).status, 303)
    const submitted = await effects(h)
    assert.equal((await publicRequest(h, intakePath, answers)).status, 409)
    assert.deepEqual(await effects(h), submitted, 'replay writes no second clinical response or audit')
    assert.ok(!(await publicRequest(h, intakePath)).text.includes(answers.q_reason))
    await assertPrivateStorage(h, [token], ['maya@patient.example', edgeAddress(1)])

    const live = await h.db.prepare('SELECT id FROM bm_appointments WHERE intake_token_hash IS NOT NULL AND status=\'booked\'').first()
    await h.cmd('appointment.cancel', { id: live.id, reason: 'Cancel appointment and its intake access' })
    const cancelled = await effects(h)
    assert.equal((await publicRequest(h, intakePath)).status, 404)
    assert.equal((await publicRequest(h, intakePath, answers)).status, 404)
    assert.deepEqual(await effects(h), cancelled, 'appointment lifetime bounds the intake bearer')
  } finally { await h.close() }
})

test('SEC-002: each public door enforces independent address and server patient email quotas before domain or provider effects', { timeout: 120_000 }, async () => {
  const stripe = fakeProviders(), h = await harness({ outbound: stripe.handler })
  try {
    const { starts, booking } = await securityClinic(h)
    await h.cmd('pay.stripe.connect', { secretKey: 'sk_test_' + 'a'.repeat(24) })
    const booked = await publicRequest(h, '/book', booking(starts[0]))
    assert.equal(booked.status, 303)
    const intakePath = booked.location.split('?')[0]
    const client = await h.db.prepare('SELECT id FROM bm_clients WHERE email=?').bind('maya@patient.example').first()
    const pay = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'card', delivery: 'shown' })
    const payPath = new URL(pay.url).pathname
    const beforeOrigin = await effects(h, stripe)
    assert.equal((await publicRequest(h, payPath + '?do=card', { consent: 'on' }, { headers: { origin: 'https://foreign.example' } })).status, 403)
    assert.deepEqual(await effects(h, stripe), beforeOrigin)

    // Different addresses and attacker-supplied emails cannot evade the live
    // patient email resolved from either private link.
    for (const path of [intakePath, payPath]) {
      await untilLimited(n => publicRequest(h, path, undefined, { address: edgeAddress(1000 + n), headers: { 'x-patient-email': `invented-${n}@example.test` } }))
      const before = await effects(h, stripe)
      const fields = path === payPath ? { consent: 'on', email: 'different@example.test' } : { email: 'different@example.test', q_reason: 'Private new clinical answer' }
      assert.equal((await publicRequest(h, path === payPath ? path + '?do=card' : path, fields, { address: edgeAddress(2000) })).status, 429)
      assert.deepEqual(await effects(h, stripe), before, 'patient quota refusal precedes clinical writes, audit and Stripe')
      const denied = await publicRequest(h, path, fields, { address: edgeAddress(2001) })
      assert.equal(denied.status, 429)
      for (const secret of ['Maya', 'maya@patient.example', 'different@example.test', 'Private new clinical answer']) assert.ok(!denied.text.includes(secret), 'a refusal echoes no patient or clinical input')
      if (path === payPath) {
        assert.equal((await publicRequest(h, path + '/statement.pdf')).status, 429)
        assert.equal((await publicRequest(h, path + '/statement.pdf', {}, { headers: { origin: 'https://foreign.example' } })).status, 403)
        assert.deepEqual(await effects(h, stripe), before, 'refused downloads create no document audit or provider request')
      }
    }
    const shared = await h.cmd('client.save', { firstName: 'Shared', lastName: 'Mailbox', email: 'maya@patient.example' })
    const sharedLink = await h.cmd('pay.link.create', { clientId: shared.id, purpose: 'card', delivery: 'shown' })
    const beforeShared = await effects(h, stripe)
    assert.equal((await publicRequest(h, new URL(sharedLink.url).pathname, undefined, { address: edgeAddress(2100) })).status, 429, 'another patient file and bearer cannot reset a shared email quota')
    assert.deepEqual(await effects(h, stripe), beforeShared)

    const missing = await h.cmd('client.save', { firstName: 'No', lastName: 'Email' })
    const missingLinks = await Promise.all([1, 2].map(() => h.cmd('pay.link.create', { clientId: missing.id, purpose: 'card', delivery: 'shown' })))
    await untilLimited(n => publicRequest(h, new URL(missingLinks[0].url).pathname, undefined, { address: edgeAddress(2200 + n) }))
    const beforeMissing = await effects(h, stripe)
    assert.equal((await publicRequest(h, new URL(missingLinks[1].url).pathname + '?do=card', { consent: 'on' }, { address: edgeAddress(2400) })).status, 429, 'a missing-email patient has one opaque quota across private links')
    assert.deepEqual(await effects(h, stripe), beforeMissing)
    const separate = await h.cmd('client.save', { firstName: 'Another', lastName: 'No email' })
    const separateLink = await h.cmd('pay.link.create', { clientId: separate.id, purpose: 'card', delivery: 'shown' })
    assert.equal((await publicRequest(h, new URL(separateLink.url).pathname, undefined, { address: edgeAddress(2401) })).status, 200)
    // The same address still has separate allowances for other public doors.
    await untilLimited(n => publicRequest(h, '/book', { email: n % 2 ? '  ABUSE@patient.example  ' : 'abuse@patient.example', website: 'bot' }, { address: edgeAddress(3000 + n) }))
    const beforeEmail = await effects(h, stripe)
    assert.equal((await publicRequest(h, '/book', booking(starts[4], { email: 'abuse@patient.example' }), { address: edgeAddress(4000) })).status, 429)
    assert.deepEqual(await effects(h, stripe), beforeEmail)
    assert.equal((await publicRequest(h, '/book', { email: 'fresh@patient.example', website: 'bot' }, { address: edgeAddress(4001) })).status, 400)

    const address = edgeAddress(5000)
    for (const path of ['/book', '/intake/' + 'x'.repeat(32), '/pay/' + 'x'.repeat(32), '/portal/confirm']) {
      const fields = path === '/portal/confirm' ? { token: 'x'.repeat(43) } : undefined
      await untilLimited(() => publicRequest(h, path, fields, { address }))
      const before = await effects(h, stripe)
      const blocked = await publicRequest(h, path, fields, { address, headers: { 'x-forwarded-for': edgeAddress(6000), 'x-real-ip': edgeAddress(6001) } })
      assert.equal(blocked.status, 429)
      assert.deepEqual(await effects(h, stripe), before)
      assert.notEqual((await publicRequest(h, path, fields, { address: edgeAddress(7000) })).status, 429, 'a different trusted edge address has its own allowance')
    }
    const nonCf = await harness({ direct: true })
    try {
      await untilLimited(n => publicRequest(nonCf, '/book', undefined, { cf: null, address: edgeAddress(8000 + n), headers: { 'x-forwarded-for': edgeAddress(9000 + n) } }))
      assert.equal((await publicRequest(nonCf, '/book', undefined, { cf: null, address: edgeAddress(10000) })).status, 429, 'without Cloudflare request metadata, changing forwarded addresses cannot select a new allowance')
    } finally { await nonCf.close() }
    await assertPrivateStorage(h, [intakePath.split('/').at(-1), payPath.split('/').at(-1)], [client.id, missing.id, 'maya@patient.example', address])
  } finally { await h.close() }
})

test('SEC-002: portal notices conceal address/email refusal, confirmation races cannot create extra sessions, local forwarded addresses cannot evade quotas', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    const email = 'portal@patient.example'
    const patient = await h.cmd('client.save', { firstName: 'Portal', lastName: 'Patient', email })
    const beforeCross = await effects(h)
    for (const [path, fields] of [['/portal', { email }], ['/portal/confirm', { token: 'x'.repeat(43) }]]) {
      assert.equal((await publicRequest(h, path, fields, { headers: { origin: 'https://foreign.example' } })).status, 403)
    }
    assert.deepEqual(await effects(h), beforeCross)

    const first = await publicRequest(h, '/portal', { email })
    assert.equal(first.status, 200)
    const token = portalToken(h, email)
    const beforeConfirmCross = await effects(h)
    assert.equal((await publicRequest(h, '/portal/confirm', { token }, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
    assert.deepEqual(await effects(h), beforeConfirmCross)
    const race = await Promise.all(Array.from({ length: 12 }, (_, n) => publicRequest(h, '/portal/confirm', { token }, { address: edgeAddress(100 + n) })))
    assert.equal(race.filter(r => r.status === 303).length, 1)
    assert.ok(race.every(r => [303, 409, 410, 429].includes(r.status)))
    const signedIn = race.find(r => r.status === 303)
    const session = signedIn.cookie.split(';')[0].split('=').at(-1)
    assert.equal((await publicRequest(h, '/portal/confirm', { token }, { address: edgeAddress(200) })).status, 410)
    await assertPrivateStorage(h, [token, session], [email, patient.id])
    assert.equal((await publicRequest(h, '/portal', { email }, { address: edgeAddress(201) })).status, 200)
    const unusedToken = portalToken(h, email)
    const deniedAddress = edgeAddress(202)
    await untilLimited(() => publicRequest(h, '/portal/confirm', { token: 'x'.repeat(43) }, { address: deniedAddress }))
    const beforeDeniedConfirm = await effects(h)
    const deniedConfirm = await publicRequest(h, '/portal/confirm', { token: unusedToken, email: 'forged@example.test' }, { address: deniedAddress })
    assert.equal(deniedConfirm.status, 429)
    assert.ok(!deniedConfirm.cookie, 'refused confirmation grants no session cookie')
    assert.deepEqual(await effects(h), beforeDeniedConfirm, 'confirmation quota leaves the bearer unused and creates no session or audit')
    const unused = await h.db.prepare('SELECT used_at FROM bm_portal_links WHERE token_hash=?').bind(createHash('sha256').update(unusedToken).digest('hex')).first()
    assert.equal(unused.used_at, null)

    let refusedNotice
    for (let n = 0; n < 200; n++) {
      const before = await effects(h)
      const result = await publicRequest(h, '/portal', { email: n % 2 ? '  PORTAL@patient.example ' : email }, { address: edgeAddress(300 + n) })
      assert.equal(result.status, 200)
      if (h.mail.length === before.mail) {
        refusedNotice = result.text
        assert.deepEqual(await effects(h), before, 'email quota reveals no patient and sends no mail')
        break
      }
    }
    assert.ok(refusedNotice)
    assert.equal(refusedNotice, first.text)

    // Exhaust sign-in by address using changing unknown emails. A real known
    // patient then gets exactly the same notice and no provider request.
    const otherEmail = 'other@patient.example'
    await h.cmd('client.save', { firstName: 'Other', lastName: 'Patient', email: otherEmail })
    const address = edgeAddress(1000)
    for (let n = 0; n < 200; n++) assert.equal((await publicRequest(h, '/portal', { email: `unknown-${n}@example.test` }, { address })).status, 200)
    const exhausted = await effects(h)
    const blocked = await publicRequest(h, '/portal', { email: otherEmail }, { address })
    assert.equal(blocked.status, 200)
    assert.equal(blocked.text, first.text)
    assert.deepEqual(await effects(h), exhausted)
    assert.equal((await publicRequest(h, '/portal', { email: otherEmail }, { address: edgeAddress(1001) })).status, 200)
    assert.equal(h.mail.length, exhausted.mail + 1)
  } finally { await h.close() }

  const local = await harness({ auth: { AUTH_LOCAL: 'true' } })
  try {
    // Even supplied Cloudflare metadata is ignored on a local installation.
    await untilLimited(n => publicRequest(local, '/book', undefined, { address: edgeAddress(2000 + n), headers: { 'x-forwarded-for': edgeAddress(3000 + n) } }))
    const before = await effects(local)
    assert.equal((await publicRequest(local, '/book', undefined, { address: edgeAddress(4000) })).status, 429)
    assert.deepEqual(await effects(local), before)
    await assertPrivateStorage(local, [], [edgeAddress(4000)])
  } finally { await local.close() }
})

test('SEC-001: every staff job needs an independent second step; owner device revocation, one-use recovery and idle timeout deny the next request', {timeout:120000}, async()=>{
 const h=await harness({autoMfa:false,browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 const {authenticatorCode}=await import('./staff-second-step.mjs')
 try{
  await h.state(h.owner,401)
  assert.equal((await h.send('/app',undefined,h.owner)).headers.get('location'),'/auth/security')
  assert.equal((await h.send('/auth/operators',undefined,h.owner)).status,401)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'SEC-001-enrollment',path:'/auth/security',cookie:h.owner}])}
  const activate=async (cookie,email)=>{
   const pending=await h.send('/auth/security/enroll',{},cookie);assert.equal(pending.status,200)
   if(email){const other=await h.signIn(email);assert.equal((await h.send('/auth/security/activate',{code:authenticatorCode(pending.value.secret)},other)).status,409,'enrollment is bound to its initiating session')}
   const active=await h.send('/auth/security/activate',{code:authenticatorCode(pending.value.secret)},cookie)
   assert.equal(active.status,200,'a real independently calculated authenticator code activates the factor')
   const sealed=(await h.db.prepare('SELECT sealed_seed FROM bm_staff_factors ORDER BY created_at DESC LIMIT 1').first()).sealed_seed
   assert.ok(!sealed.includes(pending.value.secret),'only ciphertext is stored')
   return {secret:pending.value.secret,codes:active.value.recoveryCodes}
  }
  const ownerFactor=await activate(h.owner)
  await h.finishSetup()
  await h.cmd('settings.save',{clinicName:'Synthetic secure clinic',timeZone:'America/New_York',taxId:'12-3456789',address:'100 Main St'})
  assert.equal((await h.send('/auth/security/verify',{code:authenticatorCode(ownerFactor.secret)},h.owner)).status,401,'a consumed authenticator time step cannot be replayed')
  const location=await h.cmd('location.save',{name:'Synthetic secure location'})
  const supervisor=await h.staff('SecureSupervisor','supervisor',{discipline:'pt',credentials:'PT'})
  const staff=[supervisor]
  for(const kind of ['practitioner','reception','biller','assistant','student','fellow','location_manager'])staff.push(await h.staff('Secure'+kind,kind,{discipline:'pt',supervisorId:supervisor.id,locationId:location.id}))
  for(const person of staff){
   await h.state(person.cookie,401)
   await h.cmd('client.save',{firstName:'Unproved',lastName:'Session'},person.cookie,401)
   await activate(person.cookie,person.email)
   await h.state(person.cookie)
   assert.equal((await h.send('/auth/security/policy',{idleMinutes:1,requireAll:true},person.cookie)).status,403)
  }
  const factorCount=(await h.db.prepare('SELECT COUNT(*) n FROM bm_staff_factors').first()).n
  assert.equal((await h.send('/auth/security/enroll',{},h.owner,{origin:'https://foreign.example'})).status,403)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_staff_factors').first()).n,factorCount)
  const another=await h.signIn(h.auth.OWNER_EMAIL)
  await h.state(another,401)
  assert.equal((await h.send('/auth/security/verify',{code:ownerFactor.codes[0]},another)).status,200)
  const anotherState=await h.send('/auth/security',undefined,another,{accept:'application/json'})
  assert.equal(anotherState.status,200)
  const device=anotherState.value.currentSessionId
  const list=await h.send('/auth/security',undefined,h.owner,{accept:'application/json'})
  assert.ok(list.value.sessions.some(s=>s.id===device&&s.verified_at))
  assert.equal(list.value.policy.idle_minutes,15)
  assert.equal((await h.send('/auth/security/revoke',{sessionId:device},h.owner)).status,200)
  await h.state(another,401)
  await h.cmd('client.save',{firstName:'Revoked',lastName:'Session'},another,401)
  const third=await h.signIn(h.auth.OWNER_EMAIL)
  assert.equal((await h.send('/auth/security/verify',{code:ownerFactor.codes[0]},third)).status,401,'one-use recovery cannot be replayed on another device')
  assert.equal((await h.send('/auth/security/verify',{code:ownerFactor.codes[1]},third)).status,200)
  assert.equal((await h.send('/auth/security/policy',{idleMinutes:1,requireAll:true},h.owner)).status,200)
  const current=await h.send('/auth/security',undefined,third,{accept:'application/json'})
  // Fixture ages only this device's activity; no product clock or timeout bypass exists.
  if(process.env.BALM_REAL_IDLE==='1'){
   await new Promise(resolve=>setTimeout(resolve,30000));await h.state()
   await new Promise(resolve=>setTimeout(resolve,32000))
  }else await h.db.prepare('UPDATE bm_staff_session_proofs SET last_seen_at=? WHERE session_id=?').bind(Date.now()-61000,current.value.currentSessionId).run()
  await h.state(third,401)
  assert.equal((await h.send('/auth/security/verify',{code:ownerFactor.codes[2]},third)).status,401,'an idle device needs a fresh email sign-in as well as the second step')
  const limited=await h.signIn(staff[2].email)
  let refusal
  for(let i=0;i<6;i++)refusal=await h.send('/auth/security/verify',{code:'invalid'},limited)
  assert.equal(refusal.status,429)
  assert.equal((await h.state()).clients.some(c=>['Unproved','Revoked'].includes(c.first_name)),false)
  const audit=(await h.db.prepare("SELECT action FROM bm_audit WHERE action LIKE 'session.%'").all()).results
  for(const action of ['session.second_step_verified','session.idle_expired','session.remotely_revoked','session.policy_saved'])assert.ok(audit.some(a=>a.action===action),action)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'SEC-001-devices',path:'/auth/security',cookie:h.owner},{name:'SEC-001-policy',path:'/auth/security',cookie:h.owner,selector:'form[action="/auth/security/policy"]'}])}
 }finally{await h.close()}
})

test('SEC-001: staff regenerates a private recovery set, old codes are invalidated and every use is audited and shown at the next sign-in', {timeout:120000}, async()=>{
 const h=await harness({autoMfa:false})
 const {authenticatorCode}=await import('./staff-second-step.mjs')
 try{
  const pending=await h.send('/auth/security/enroll',{},h.owner)
  assert.equal(pending.status,200)
  const other=await h.signIn(h.auth.OWNER_EMAIL)
  const active=await h.send('/auth/security/activate',{code:authenticatorCode(pending.value.secret)},h.owner)
  assert.equal(active.status,200)
  assert.equal(active.value.recoveryCodes.length,10)
  assert.equal(new Set(active.value.recoveryCodes).size,10)
  assert.equal((await h.send('/auth/security/recoveries',{code:active.value.recoveryCodes[0]},other)).status,401,'email sign-in cannot regenerate or bypass the second step')
  const factor=await h.db.prepare('SELECT * FROM bm_staff_factors').first()
  const stored=(await h.db.prepare('SELECT code_hash FROM bm_staff_recovery').all()).results
  for(const code of active.value.recoveryCodes){
   assert.ok(stored.some(row=>row.code_hash===createHash('sha256').update('balm-recovery:'+factor.recovery_salt+':'+code).digest('hex')),'only a salted hash is persisted')
   assert.ok(!JSON.stringify(stored).includes(code))
  }
  const regenerated=await h.send('/auth/security/recoveries',{code:authenticatorCode(pending.value.secret,Date.now()+30000)},h.owner)
  assert.equal(regenerated.status,200,regenerated.text)
  assert.equal(regenerated.value.recoveryCodes.length,10)
  const page=await h.send('/auth/security',undefined,h.owner)
  assert.equal(page.status,200,page.text)
  for(const code of [...active.value.recoveryCodes,...regenerated.value.recoveryCodes])assert.ok(!page.text.includes(code),'no later read returns recovery codes')
  assert.equal((await h.send('/auth/security/verify',{code:active.value.recoveryCodes[0]},other)).status,401,'regeneration invalidates the whole previous set')
  const mailCount=h.mail.length
  assert.equal((await h.send('/auth/security/verify',{code:regenerated.value.recoveryCodes[0]},other)).status,200)
  assert.equal(h.mail.length,mailCount,'recovery sends no outbound notice')
  const next=await h.signIn(h.auth.OWNER_EMAIL)
  await h.state(next,401)
  const notice=await h.send('/auth/security',undefined,next)
  assert.equal(notice.status,200)
  assert.match(notice.text,/aria-label="Recovery code use"/)
  const stranger=await h.send('/auth/security')
  assert.equal(stranger.status,401,'recovery use is private to the signed-in identity')
  assert.equal((await h.send('/auth/security/verify',{code:regenerated.value.recoveryCodes[0]},next)).status,401,'a recovery code is usable only once')
  const events=(await h.db.prepare("SELECT action,detail FROM bm_audit WHERE action IN ('session.recovery_used','session.recovery_regenerated')").all()).results
  assert.deepEqual(events.map(e=>e.action).sort(),['session.recovery_regenerated','session.recovery_used'])
  for(const code of regenerated.value.recoveryCodes)assert.ok(!JSON.stringify(events).includes(code),'audit never contains credentials')
 }finally{await h.close()}
})

test('SEC-001: federation preserves live Balm roles and independent factors', {timeout:120000}, async()=>{const {federatedStaffJourney}=await import('./federated-staff.mjs');await federatedStaffJourney()})

test('only the owner changes a sign-in email; a staff session keeps its own job', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    const desk = await h.staff('Rhea', 'reception')
    // A practitioner on the staff list who has no sign-in of their own yet.
    await h.cmd('staff.save', { name: 'Theo Grant', email: 'theo@clinic.example', role: 'practitioner', active: true })
    const before = (await h.state(desk.cookie)).actor
    const refused = await h.send('/auth/email', { email: 'theo@clinic.example' }, desk.cookie)
    assert.equal(refused.status, 403, refused.text)
    assert.deepEqual((await h.state(desk.cookie)).actor, before, 'the session keeps its own identity, job and scope')
    const fresh = await h.signIn(h.auth.OWNER_EMAIL)
    const corrected = await h.send('/auth/email', { email: 'jordan@clinic.example' }, fresh)
    assert.equal(corrected.status, 200, corrected.text)
    assert.equal(corrected.value.email, 'jordan@clinic.example')
  } finally { await h.close() }
})

test('a public booking cannot put a patient’s email on a second file or end their portal access', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    const { starts, booking } = await securityClinic(h)
    const email = 'portal@patient.example'
    await h.cmd('client.save', { firstName: 'Portal', lastName: 'Patient', dateOfBirth: '1975-09-12', email })
    const cookie = await portalLogin(h, email)
    assert.equal((await h.send('/portal/home', undefined, cookie)).status, 200)
    const before = await effects(h)
    // Someone else's name and birth date with the patient's email.
    const refused = await publicRequest(h, '/book', booking(starts[0], { email }))
    assert.equal(refused.status, 409)
    assert.match(refused.text, /patient portal/)
    assert.deepEqual(await effects(h), before, 'no second file, visit, intake or email')
    assert.equal((await h.send('/portal/home', undefined, cookie)).status, 200, 'the patient stays signed in')
    assert.equal((await h.send('/portal/home', undefined, await portalLogin(h, email))).status, 200, 'and can still sign in')
  } finally { await h.close() }
})
