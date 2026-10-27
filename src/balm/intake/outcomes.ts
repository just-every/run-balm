import { insist,text,type Data } from '../domain/model'
export const instruments = {
 lefs:{name:'LEFS',count:20,min:0,max:4,minimum:20,unit:'out of 80',direction:'Higher scores indicate better function',source:'https://www.sralab.org/rehabilitation-measures/lower-extremity-functional-scale'},
 oswestry:{name:'Oswestry Disability Index',count:10,min:0,max:5,minimum:9,unit:'%',direction:'Higher scores indicate more disability',source:'https://www.sralab.org/rehabilitation-measures/oswestry-disability-index'},
 ndi:{name:'Neck Disability Index',count:10,min:0,max:5,minimum:8,unit:'%',direction:'Higher scores indicate more disability',source:'https://www.sralab.org/rehabilitation-measures/neck-disability-index'},
 quickdash:{name:'QuickDASH',count:11,min:1,max:5,minimum:10,unit:'out of 100',direction:'Higher scores indicate more disability',source:'https://dash.iwh.on.ca/scoring'},
 psfs:{name:'Patient-Specific Functional Scale',count:5,min:0,max:10,minimum:1,unit:'out of 10',direction:'Higher scores indicate better function',source:'https://www.sralab.org/rehabilitation-measures/patient-specific-functional-scale'}
} as const
export type InstrumentKind = keyof typeof instruments
export function prepareInstruments(input:unknown){
 insist(input===undefined||Array.isArray(input),'invalid_outcome_questionnaires')
 const list=(input??[]) as Data[];insist(list.length<=5,'too_many_outcome_questionnaires')
 const seen=new Set<string>()
 return list.map(item=>{
  const kind=text(item?.kind,'outcome_questionnaire',20) as InstrumentKind,spec=instruments[kind];insist(spec&&!seen.has(kind),'invalid_outcome_questionnaire');seen.add(kind)
  // The practice supplies its authorized item wording, preserving order from
  // the standard instrument. This code supplies scoring, not a licensed text copy.
  insist(Array.isArray(item.items)&&item.items.every((label:unknown)=>typeof label==='string'),'enter_authorized_questionnaire_items')
  insist(kind==='psfs'?item.items.length>=1&&item.items.length<=5:item.items.length===spec.count,'outcome_item_count_does_not_match_standard')
  return {kind,name:spec.name,instrumentVersion:'',scoringVersion:'1',items:item.items.map((label:unknown)=>text(label,'outcome_item',500)),min:spec.min,max:spec.max,minimum:kind==='psfs'?item.items.length:spec.minimum,unit:spec.unit,direction:spec.direction,source:spec.source}
 })
}
export function outcomeQuestions(list:ReturnType<typeof prepareInstruments>){
 return list.flatMap(item=>item.items.map((label:string,i:number)=>({id:'out_'+item.kind+'_'+(i+1),label:item.name+' · '+label,type:'number' as const,required:item.minimum===item.items.length,min:item.min,max:item.max})))
}
export function outcomeScores(list:ReturnType<typeof prepareInstruments>,answers:Record<string,string|boolean>){
 return list.map(item=>{
  const values=item.items.map((_:string,i:number)=>answers['out_'+item.kind+'_'+(i+1)]).filter(v=>v!==undefined&&v!=='').map(Number)
  insist(values.length>=item.minimum,'complete_the_'+item.kind+'_questionnaire')
  const total=values.reduce((sum,v)=>sum+v,0),mean=total/values.length
  const score=item.kind==='lefs'?total:item.kind==='quickdash'?(mean-1)*25:item.kind==='psfs'?mean:total/(values.length*5)*100
  return {kind:item.kind,name:item.name,instrumentVersion:item.instrumentVersion,scoringVersion:item.scoringVersion,score:Math.round(score*100)/100,answered:values.length,items:item.items.length,rawTotal:total,unit:item.unit,direction:item.direction}
 })
}
/** Older responses remain separate by their immutable form; no guessed version. */
export function comparableOutcome(score:Data,formId:string){
 if(!score.kind||!score.scoringVersion||!score.unit)return null
 return {source:'Intake',instrument:score.name??score.kind,instrumentVersion:score.instrumentVersion||'Legacy form '+formId,scoringVersion:score.scoringVersion,side:'none',unit:score.unit,direction:score.direction??''}
}
/** Trusted SQL expression: serviceExpression is an internal column or a placeholder. */
export function chosenFormSql(serviceExpression:string){return `(SELECT f.id FROM bm_intake_forms f JOIN bm_services svc ON svc.id=${serviceExpression}
 WHERE f.service_id=svc.id OR f.service_id IS NULL AND f.discipline<>'' AND f.discipline=COALESCE(NULLIF(svc.intake_discipline,''),substr(svc.note_template,1,instr(svc.note_template,'.')-1)) OR f.service_id IS NULL AND f.discipline=''
 ORDER BY CASE WHEN f.service_id IS NOT NULL THEN 2 WHEN f.discipline<>'' THEN 1 ELSE 0 END DESC,f.number DESC LIMIT 1)`}
