import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto'

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const sha256 = value => createHash('sha256').update(value).digest('base64url')

/** Only the external Auth HTTP edge is synthetic; Balm verifies real ES256 tokens. */
export function staffIdp() {
  const issuer = 'https://staff-idp.clinic.example', clientId = 'synthetic-balm-2'
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' }), kid = randomUUID()
  const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig', key_ops: ['verify'] }
  const codes = new Map(), assertions = new Set()
  let registration, linkRedeemed = false

  function verifyAssertion(token, audience, subject) {
    const parts = token.split('.')
    assert.equal(parts.length, 3)
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'))
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
    assert.equal(header.alg, 'ES256')
    const jwk = registration.keys.find(key => key.kid === header.kid)
    assert.ok(jwk, 'client assertion uses the registered public key')
    assert.ok(verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')))
    assert.equal(claims.iss, subject)
    assert.equal(claims.sub, subject)
    assert.equal(claims.aud, audience)
    const now = Math.floor(Date.now() / 1000)
    assert.ok(claims.iat <= now + 5 && claims.exp > now && claims.exp <= claims.iat + 60)
    assert.equal(typeof claims.jti, 'string')
    assert.ok(!assertions.has(claims.jti), 'client assertions are one-use')
    assertions.add(claims.jti)
    return claims
  }

  function signedToken(claims) {
    const input = `${encode({ alg: 'ES256', typ: 'JWT', kid })}.${encode(claims)}`
    return input + '.' + sign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  }

  return {
    issuer,
    register(document, jwks) {
      assert.equal(document.callback, document.origin + '/.well-known/rer-link/callback')
      assert.ok(document.dependencies.some(d => d.interface === 'oidc-provider@1'))
      registration = { ...document, keys: jwks.keys }
    },
    /** Emulates the provider's browser authorization; the code remains bound to this request. */
    authorize(location, identity) {
      const url = new URL(location), p = url.searchParams
      assert.equal(url.origin + url.pathname, issuer + '/authorize')
      assert.equal(p.get('client_id'), clientId)
      assert.equal(p.get('response_type'), 'code')
      assert.equal(p.get('code_challenge_method'), 'S256')
      assert.ok(p.get('nonce') && p.get('state') && p.get('code_challenge'))
      assert.equal(p.get('redirect_uri'), registration.origin + '/auth/oidc/auth/callback')
      const code = randomUUID()
      codes.set(code, { identity, nonce: p.get('nonce'), challenge: p.get('code_challenge'), redirect: p.get('redirect_uri') })
      const callback = new URL(p.get('redirect_uri'))
      callback.search = new URLSearchParams({ code, state: p.get('state'), iss: issuer }).toString()
      return callback.pathname + callback.search
    },
    async handler(request) {
      const url = new URL(request.url)
      assert.equal(url.origin, issuer, 'unexpected external service')
      if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') return Response.json({
        issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
        response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['ES256'],
        token_endpoint_auth_methods_supported: ['private_key_jwt'], token_endpoint_auth_signing_alg_values_supported: ['ES256'],
        authorization_response_iss_parameter_supported: true, rer_interfaces: ['oidc-provider@1.0.0'],
      })
      if (request.method === 'GET' && url.pathname === '/.well-known/rer-provider') return Response.json({
        issuer, version: 1, interface: 'oidc-provider@1', initiate: issuer + '/initiate', redeem: issuer + '/redeem', deregister: issuer + '/deregister',
      })
      if (request.method === 'GET' && url.pathname === '/jwks') return Response.json({ keys: [publicJwk] })
      if (request.method === 'POST' && url.pathname === '/redeem') {
        const input = await request.json()
        assert.ok(!linkRedeemed, 'link code is one-use')
        assert.equal(input.code, 'synthetic-balm-1')
        assert.equal(input.interface, 'oidc-provider@1')
        assert.equal(input.origin, registration.origin)
        assert.equal(input.callback, registration.callback)
        assert.equal(input.client_assertion_type, 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
        const claims = verifyAssertion(input.client_assertion, issuer + '/redeem', registration.origin)
        for (const key of ['code', 'interface', 'callback']) assert.equal(claims[key], input[key])
        assert.equal(claims.sector_id, registration.sector_id)
        linkRedeemed = true
        return Response.json({ issuer, interface: input.interface, origin: input.origin, callback: input.callback, sector_id: registration.sector_id, client_id: clientId })
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        const p = new URLSearchParams(await request.text()), grant = codes.get(p.get('code'))
        assert.ok(linkRedeemed && grant, 'registered client presents a live authorization code')
        codes.delete(p.get('code'))
        assert.equal(p.get('grant_type'), 'authorization_code')
        assert.equal(p.get('client_id'), clientId)
        assert.equal(p.get('redirect_uri'), grant.redirect)
        assert.equal(sha256(p.get('code_verifier')), grant.challenge)
        assert.equal(p.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
        verifyAssertion(p.get('client_assertion'), issuer + '/token', clientId)
        const now = Math.floor(Date.now() / 1000)
        return Response.json({ id_token: signedToken({
          iss: issuer, aud: clientId, sub: grant.identity.subject, email: grant.identity.email, email_verified: true,
          email_verified_at: now, iat: now, exp: now + 300, nonce: grant.nonce, sid: randomUUID(),
          role: 'owner', roles: ['owner', 'admin'], groups: ['owners'], amr: ['mfa', 'otp'],
        }) })
      }
      throw new Error(`Unexpected identity-provider request: ${request.method} ${url.pathname}`)
    },
  }
}
