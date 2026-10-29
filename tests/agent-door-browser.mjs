import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {captureAgentPages} from './agent-door-pages.mjs'

/** Exercise a real pending decision before the normal held service journey. */
export async function beforeStep(context) {
 const {phase,step,args,tool,request,origin,cookie}=context
 if(phase!=='held'||step.id!=='new-service')return
 const answer=await tool(step.tool,{...args,name:'Cedar Grove occupational therapy',idempotency_key:randomUUID()})
 const pending=answer.result?._meta?.['com.runeditrun/approval']
 assert.ok(pending?.id,'native pending approval exists')
 await captureAgentPages(context,[['pending-approval','/agents/approvals/'+encodeURIComponent(pending.id)]])
 const response=await request(origin+'/agents/api/approvals/'+encodeURIComponent(pending.id),{headers:{Cookie:cookie,Origin:origin}})
 assert.equal(response.status,200)
 const {approval}=await response.json()
 const rejected=await request(origin+'/agents/api/approvals/'+encodeURIComponent(pending.id)+'/reject',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({revision:approval.revision,summary_sha256:approval.summary_sha256})})
 assert.equal(rejected.status,200);await rejected.body?.cancel()
 await captureAgentPages(context,[['rejected-approval','/agents/approvals/'+encodeURIComponent(pending.id)]])
}

/** Browser leg of the declared public-door journey, using its real native session. */
export default async function(context) {
 const {request,origin,cookie,tool}=context
 const unknown=await tool('balm.unknown.operation',{})
 assert.equal(unknown.body?.error?.data?.code,'tool_not_found')
 const approvals=await request(origin+'/agents/api/approvals',{headers:{Cookie:cookie,Origin:origin}})
 assert.equal(approvals.status,200)
 const saved=await approvals.json(),completed=saved.approvals?.find(a=>a.state==='approved'||a.state==='executed')??saved.approvals?.[0]
 const paths=[['agents','/agents'],...(completed?[['approval','/agents/approvals/'+encodeURIComponent(completed.id)]]:[]),['missing-approval','/agents/approvals/missing-native-record']]
 await captureAgentPages(context,paths)
 const paused=await request(origin+'/agents/api/pause',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({paused:true})});assert.equal(paused.status,200);await paused.body?.cancel()
 await captureAgentPages(context,[['paused','/agents']])
 const resumed=await request(origin+'/agents/api/pause',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({paused:false})});assert.equal(resumed.status,200);await resumed.body?.cancel()
}
