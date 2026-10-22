import {insist} from '../domain/model'

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const base32=(bytes:Uint8Array)=>{let n=0,bits=0,out='';for(const b of bytes){n=(n<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(n>>>bits)&31]}}if(bits)out+=alphabet[(n<<(5-bits))&31];return out}
function decode(value:string){let n=0,bits=0,out:number[]=[];for(const c of value){const i=alphabet.indexOf(c);insist(i>=0,'invalid_authenticator_secret');n=(n<<5)|i;bits+=5;if(bits>=8){bits-=8;out.push((n>>>bits)&255)}}return new Uint8Array(out)}
async function totp(seed:string,step:number){
 const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(step))
 const key=await crypto.subtle.importKey('raw',decode(seed),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)),offset=mac[19]&15
 return String((new DataView(mac.buffer).getUint32(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
export async function matchedStep(seed:string,code:string){
 if(!/^\d{6}$/.test(code))return null
 const current=Math.floor(Date.now()/30000)
 for(const step of [current,current-1,current+1])if(await totp(seed,step)===code)return step
 return null
}
