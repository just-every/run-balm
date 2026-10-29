import { type Bindings } from '../../auth.server.ts'
import { type ResourceDefinition, type ToolContext } from '../../modules/agent-door/index.ts'
import { clinic, configuration } from './configuration.ts'
import { sponsor } from './native.ts'
import { audit, commit } from '../domain/model.ts'

export function balmResources(env:Bindings):ResourceDefinition[] {
  return ['clinic','service','staff','room','equipment','form'].map(kind=>({
    uriTemplate:`balm://${kind}/{id}`,name:kind,scope:'context.read',classes:kind==='clinic'?['standard','sensitive']:['standard'],
    classify(record){const value=record.json as Record<string,unknown>;return [{class:'standard',facts:{measure:1}},...(value?.tax_id_type==='SSN' && String(value.abn??'').replace(/\D/g,'').length===9?[{class:'sensitive' as const,facts:{measure:1,kind:'ID'}}]:[])]},
    async read(uri,principal){
      if(!principal.scopes.includes('context.read'))return null
      try {
        const ctx={...principal,scopes:principal.scopes,actor:{label:`${principal.agent.name} for ${principal.person.name}`,agent:principal.agent,for:{id:principal.person.id,name:principal.person.name}},approvers:[]} as unknown as ToolContext
        const view=await configuration(env,ctx),key=decodeURIComponent(new URL(uri).pathname.slice(1))
        const list=kind==='clinic'?[await clinic(env,ctx)]:kind==='form'?[...view.forms,...view.drafts.map((d:any)=>({...d,id:'draft-'+d.id}))]:(view as Record<string,any>)[{service:'services',staff:'staff',room:'rooms',equipment:'equipment'}[kind]!]
        const record=list.find((row:any)=>String(row.id)===key)
        if(!record)return null
        const who=await sponsor(env,ctx)
        await commit(env.DB,who,[audit(env.DB,who,'agent.resource_read',null,kind+':'+key)])
        return {json:record,untrusted:true}
      }catch{return null}
    },
  }))
}
