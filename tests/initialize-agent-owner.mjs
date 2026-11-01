import assert from 'node:assert/strict'
import { authenticatorCode } from './staff-second-step.mjs'

/** Native setup-token bootstrap, real second factor and the ordinary first-run form. */
export default async function ({request,origin,claim,displayName}) {
  const bootstrap=await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo:'/setup'})})
  assert.equal(bootstrap.status,303,'native setup-token bootstrap succeeds')
  const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
  const post=async(path,body)=>request(origin+path,{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)})
  const enrollment=await post('/auth/security/enroll',{});assert.equal(enrollment.status,200)
  const factor=await enrollment.json()
  const activated=await post('/auth/security/activate',{code:authenticatorCode(factor.secret)});assert.equal(activated.status,200);await activated.body?.cancel()
  const configured=await post('/api/balm/command',{name:'settings.save',input:{clinicName:'Synthetic Therapy Clinic',timeZone:'America/New_York',taxId:'12-3456789',taxIdType:'EIN',bookingOpen:false}});assert.equal(configured.status,200);await configured.body?.cancel()
  const colleague=await post('/api/balm/command',{name:'staff.save',input:{name:'Synthetic Clinic Colleague',email:'synthetic-colleague@example.invalid',role:'reception',active:false}});assert.equal(colleague.status,200);await colleague.body?.cancel()
  const setup=await request(origin+'/setup',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:'confirm=yes'})
  assert.equal(setup.status,303);await setup.body?.cancel()
  return bootstrap
}
