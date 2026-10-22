import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
const factors=new Map()
export function authenticatorCode(secret,time=Date.now()){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let n=0,bits=0,bytes=[]
 for(const c of secret){n=(n<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((n>>>bits)&255)}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)))
 const mac=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=mac[19]&15
 return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
/** Synthetic test actors complete the real enrollment and verification doors. */
export async function authorizeTestSession(send,cookie,email,installationSecret){
 const key=createHash('sha256').update(installationSecret+':'+email.toLowerCase()).digest('hex')
 const pending=await send('/auth/security/enroll',{},cookie)
 const existing=factors.get(key)
 if(pending.status===409){
  assert.ok(existing,'synthetic actor retains its private second-step fixture')
  assert.ok(existing.recovery.length,'synthetic actor has a one-use recovery code')
  const result=await send('/auth/security/verify',{code:existing.recovery.shift()},cookie)
  assert.equal(result.status,200,'synthetic second-step verification succeeds')
 }else{
  assert.equal(pending.status,200,'synthetic authenticator enrollment succeeds')
  const active=await send('/auth/security/activate',{code:authenticatorCode(pending.value.secret)},cookie)
  assert.equal(active.status,200,'synthetic authenticator activation succeeds')
  factors.set(key,{secret:pending.value.secret,recovery:[...active.value.recoveryCodes]})
 }
}
