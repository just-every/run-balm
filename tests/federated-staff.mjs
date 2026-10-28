import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { authenticatorCode } from './staff-second-step.mjs'
import { staffIdp } from './fakes/staff-idp.mjs'

/** SEC-001: genuine OIDC admission preserves the owner's live Balm assignments. */
export async function federatedStaffJourney() {
  const idp = staffIdp(), h = await harness({ unclaimed: true, autoMfa: false, outbound: idp.handler })
  try {
    const document = await h.send('/.well-known/rer-dependencies')
    const jwks = await h.send('/.well-known/rer-link/jwks/oidc-provider@1')
    assert.equal(document.status, 200)
    assert.equal(jwks.status, 200)
    idp.register(document.value, jwks.value)
    const approval = await h.send('/auth/dependencies/setup', { issuer: idp.issuer, interface: 'oidc-provider@1', token: h.auth.SETUP_TOKEN })
    assert.equal(approval.status, 200, approval.text)
    const bootstrap = await h.send('/auth/bootstrap', { token: h.auth.SETUP_TOKEN, displayName: 'Federated clinic owner' })
    assert.equal(bootstrap.status, 303, bootstrap.text)
    const owner = bootstrap.cookie
    const command = async (name, input, cookie = owner, status = 200) => h.cmd(name, input, cookie, status)
    const activate = async cookie => {
      const pending = await h.send('/auth/security/enroll', {}, cookie)
      assert.equal(pending.status, 200, pending.text)
      const result = await h.send('/auth/security/activate', { code: authenticatorCode(pending.value.secret) }, cookie)
      assert.equal(result.status, 200, result.text)
      return result.value.recoveryCodes
    }
    const ownerRecovery = await activate(owner)
    await command('hosting.mode',{mode:'demo',reason:'Synthetic federation journey only',attest:true})
    const linked = await h.send('/.well-known/rer-link/callback', { issuer: idp.issuer, interface: 'oidc-provider@1', code: 'synthetic-balm-1' })
    assert.equal(linked.status, 200, linked.text)
    const enabled = await h.send('/auth/settings/identity', { idpSignIn: true }, owner)
    assert.equal(enabled.status, 200, enabled.text)
    assert.equal((await h.form('/setup', { confirm: 'yes' }, owner)).status, 303)
    await command('settings.save', { clinicName: 'Federated clinic', timeZone: 'America/Chicago', taxId: '12-3456789', address: '100 Main St' })
    const location = await command('location.save', { name: 'Assigned location' })

    const signIn = async (email, subject = email, expected = 303) => {
      const start = await h.send('/auth/oidc/auth/start', { returnTo: '/app' }, '', { 'CF-Connecting-IP': '192.0.2.50' })
      assert.equal(start.status, 303, start.text)
      const callback = idp.authorize(start.headers.get('location'), { email, subject })
      const response = await h.send(callback, undefined, start.cookie)
      assert.equal(response.status, expected, response.text)
      // OIDC clears its correlation cookie and sets the session in separate headers.
      const sessionCookie = response.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.startsWith(owner.split('=')[0] + '='))
      if (expected === 303) assert.ok(sessionCookie, 'OIDC completion creates a real native account session')
      else assert.equal(sessionCookie, undefined, 'refused identities receive no session')
      return sessionCookie
    }
    const requireIndependentFactor = async cookie => {
      await h.state(cookie, 401)
      await command('client.save', { firstName: 'Unproved federation', lastName: 'Refused' }, cookie, 401)
      const page = await h.send('/app', undefined, cookie)
      assert.equal(page.headers.get('location'), '/auth/security', 'IdP mfa/otp claims do not satisfy the independent Balm factor')
    }

    const federatedOwner = await signIn(h.auth.OWNER_EMAIL)
    await requireIndependentFactor(federatedOwner)
    assert.equal((await h.send('/auth/security/verify', { code: ownerRecovery[0] }, federatedOwner)).status, 200)
    assert.equal((await h.state(federatedOwner)).actor.role, 'owner')
    assert.equal((await h.send('/auth/session', undefined, federatedOwner)).value.kind, 'oidc')
    await command('location.save', { name: 'Federated owner allowed' }, federatedOwner)

    const adminInvite = await h.send('/auth/invite', { email: 'administrator@clinic.example', displayName: 'Federated administrator', role: 'admin' }, owner)
    assert.equal(adminInvite.status, 202, adminInvite.text)
    const administrator = await signIn('administrator@clinic.example')
    await requireIndependentFactor(administrator)
    await activate(administrator)
    const adminSession = await h.send('/auth/session', undefined, administrator)
    assert.equal(adminSession.status, 200, adminSession.text)
    assert.equal(adminSession.value.operator.role, 'admin')
    await h.state(administrator, 403) // A Base administrator without a clinic job has no PHI scope.
    await command('location.save', { name: 'Hostile IdP owner claim refused' }, administrator, 403)

    const people = []
    for (const kind of ['supervisor', 'practitioner', 'reception', 'biller', 'assistant', 'student', 'fellow', 'location_manager']) {
      const person = await command('staff.save', {
        name: 'Federated ' + kind, email: kind + '@clinic.example', role: kind, active: true, discipline: 'pt', credentials: 'PT',
        ...(['assistant', 'student', 'fellow'].includes(kind) ? { supervisorId: people[0].id } : {}),
        ...(kind === 'location_manager' ? { locationId: location.id } : {}),
      })
      await command('staff.invite', { id: person.id })
      const cookie = await signIn(person.email)
      await requireIndependentFactor(cookie)
      await activate(cookie)
      const state = await h.state(cookie)
      assert.equal(state.actor.staffKind, kind)
      assert.equal(state.actor.staffId, person.id)
      assert.equal(state.actor.role, ['reception', 'biller', 'location_manager'].includes(kind) ? 'reception' : 'practitioner')
      if (['assistant', 'student', 'fellow'].includes(kind)) assert.equal(state.actor.supervisorId, people[0].id)
      if (kind === 'location_manager') assert.equal(state.actor.locationId, location.id)
      await command('location.save', { name: 'Hostile IdP owner claim refused' }, cookie, 403)
      assert.equal((await h.send('/auth/security/policy', { idleMinutes: 120, requireAll: false }, cookie)).status, 403)
      people.push({ ...person, kind, cookie })
    }

    const receptionist = people.find(person => person.kind === 'reception')
    await command('client.save', { firstName: 'Allowed desk', lastName: 'Patient' }, receptionist.cookie)
    await command('staff.save', { ...receptionist, role: 'biller' })
    assert.equal((await h.state(receptionist.cookie)).actor.staffKind, 'biller', 'an existing federated session uses the current local job')
    await command('client.save', { firstName: 'Changed role', lastName: 'Refused' }, receptionist.cookie, 403)
    await command('staff.save', { ...receptionist, role: 'biller', active: false })
    await h.state(receptionist.cookie, 403)
    await command('client.save', { firstName: 'Inactive federation', lastName: 'Refused' }, receptionist.cookie, 403)
    await signIn('never-invited@clinic.example', undefined, 403)
    await signIn(h.auth.OWNER_EMAIL, people[1].email, 403)
    const final = await h.state(owner)
    assert.ok(!final.locations.some(value => value.name === 'Hostile IdP owner claim refused'))
    assert.ok(!final.clients.some(value => ['Unproved federation', 'Changed role', 'Inactive federation'].includes(value.first_name)))
    const off = await h.send('/auth/settings/identity', { idpSignIn: false }, owner)
    assert.equal(off.status, 200, off.text)
    await h.state(federatedOwner, 401)
    await h.state(people[1].cookie, 401)
  } finally { await h.close() }
}
