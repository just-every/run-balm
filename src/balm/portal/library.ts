import {audit,commit,guard,human,id,insist,integer,now,one,rows,sha256,stmt,text,type Actor,type Data,practitionerId} from '../domain/model'
import {shippedExercises,type LibraryExercise} from './library-data'
import {clientVisible} from '../domain/clients'
import {clientAuthority} from '../messages/access'

function clinical(who:Actor){human(who);insist(who.role==='owner'||practitionerId(who),'clinical_access_required',403)}
const practice=(r:Data):LibraryExercise=>({id:r.id,title:r.title,titleEs:r.title_es,instructions:r.instructions,instructionsEs:r.instructions_es,discipline:r.discipline,region:r.region,position:r.position,equipment:r.equipment,sets:r.sets,reps:r.reps,holdSeconds:r.hold_seconds,frequency:r.frequency,image:r.image,source:r.source,license:r.license})
export async function exerciseLibrary(db:D1Database,who:Actor,input:Data={}){
 clinical(who)
 const all=[...shippedExercises,...(await rows(db,'SELECT * FROM bm_practice_exercises ORDER BY title,id')).map(practice)]
 const words=String(input.q??'').trim().toLowerCase().split(/\s+/).filter(Boolean)
 const filtered=all.filter(e=>(!input.discipline||e.discipline===input.discipline)&&(!input.region||e.region===input.region)&&(!input.equipment||e.equipment===input.equipment)&&words.every(w=>[e.title,e.titleEs,e.instructions,e.instructionsEs,e.equipment].join(' ').toLowerCase().includes(w)))
 await commit(db,who,[audit(db,who,'exercise.library_searched',null)])
 return {query:{q:String(input.q??''),discipline:String(input.discipline??''),region:String(input.region??''),equipment:String(input.equipment??'')},exercises:filtered.slice(0,100),total:filtered.length,shippedCount:shippedExercises.length,counts:Object.fromEntries(['pt','ot','slp'].map(d=>[d,shippedExercises.filter(e=>e.discipline===d).length])),regions:[...new Set(all.map(e=>e.region))].sort(),equipment:[...new Set(all.map(e=>e.equipment))].sort()}
}
/** Bounded RFC 4180 CSV parser: quotes and embedded commas and newlines are kept. */
function csv(source:string){
 const lines:string[][]=[];let row:string[]=[],cell='',quoted=false
 for(let i=0;i<source.length;i++){
  const c=source[i]
  if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++}else{insist(quoted||!cell,'invalid_exercise_csv');quoted=!quoted}}
  else if(c===','&&!quoted){row.push(cell);cell=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))lines.push(row);row=[];cell=''}
  else cell+=c
 }
 insist(!quoted,'invalid_exercise_csv');row.push(cell);if(row.some(Boolean))lines.push(row)
 insist(lines.length>=2&&lines.length<=101,'import_1_to_100_exercises')
 const [header,...data]=lines;insist(new Set(header).size===header.length,'duplicate_exercise_csv_column')
 const required=['title','title_es','instructions','instructions_es','discipline','region','position','equipment','sets','reps','hold_seconds','frequency','media']
 insist(required.every(k=>header.includes(k))&&header.every(k=>required.includes(k)),'use_the_documented_exercise_csv_columns')
 return data.map(line=>{insist(line.length===header.length,'exercise_csv_row_width');return Object.fromEntries(header.map((k,i)=>[k,line[i]]))})
}
function raster(value:unknown){
 const content=text(value,'exercise_image',1400000),match=content.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
 insist(match,'use_png_jpeg_or_webp_media')
 const bytes=atob(match[2]);insist(bytes.length<=1048576,'exercise_image_must_be_under_1mb')
 insist(match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP','invalid_exercise_image')
 return content
}
export async function importExercises(db:D1Database,who:Actor,input:Data){
 clinical(who)
 insist(input.rights===true||input.rights==='on','confirm_the_practice_has_rights_to_the_exercises_and_media')
 const parsed=csv(text(input.csv,'exercise_csv',1000000)),media=input.media&&typeof input.media==='object'?input.media:{}
 const prepared=await Promise.all(parsed.map(async r=>{
  insist(['pt','ot','slp'].includes(r.discipline),'choose_pt_ot_or_slp')
  const filename=text(r.media,'media_filename',120);insist(!/[\/\\]/.test(filename),'use_media_filenames_without_paths')
  const value={title:text(r.title,'title',200),titleEs:text(r.title_es,'Spanish_title',200),instructions:text(r.instructions,'instructions',10000),instructionsEs:text(r.instructions_es,'Spanish_instructions',10000),discipline:r.discipline,region:text(r.region,'region',100),position:text(r.position,'position',100),equipment:text(r.equipment,'equipment',100),sets:integer(r.sets,'sets',1,100),reps:text(r.reps,'reps',100),hold:integer(r.hold_seconds,'hold_seconds',0,600),frequency:text(r.frequency,'frequency',100),image:raster(media[filename])}
  return {key:id(),...value,digest:await sha256(JSON.stringify(value))}
 }))
 await commit(db,who,[...prepared.map(v=>stmt(db,`INSERT INTO bm_practice_exercises(id,title,title_es,instructions,instructions_es,discipline,region,position,equipment,sets,reps,hold_seconds,frequency,image,source,license,created_at,created_by,content_sha256)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(content_sha256) DO NOTHING`,v.key,v.title,v.titleEs,v.instructions,v.instructionsEs,v.discipline,v.region,v.position,v.equipment,v.sets,v.reps,v.hold,v.frequency,v.image,'Practice CSV upload','Practice-owned; not part of the CC0 collection',now(),who.email,v.digest)),audit(db,who,'exercise.library_imported',null,null,String(prepared.length))])
 return {processed:prepared.length}
}
export async function assignLibraryProgram(db:D1Database,who:Actor,input:Data){
 clinical(who)
 const client=await clientVisible(db,who,input.clientId),noteId=text(input.noteId,'source_note',100)
 const note=await one(db,"SELECT id FROM bm_notes WHERE id=? AND client_id=? AND (?='owner' OR author_id=?)",noteId,client.id,who.role,practitionerId(who)??'')
 insist(note,'source_note_not_found',404)
 const ids=Array.isArray(input.exerciseIds)?input.exerciseIds:typeof input.exerciseIds==='string'?input.exerciseIds.split(/[ ,]+/).filter(Boolean):[]
 insist(ids.length>=1&&ids.length<=20&&new Set(ids).size===ids.length,'choose_1_to_20_distinct_exercises')
 const all=[...shippedExercises,...(await rows(db,'SELECT * FROM bm_practice_exercises')).map(practice)]
 const chosen=ids.map(key=>{const item=all.find(e=>e.id===key);insist(item,'library_exercise_not_found',404);const dose=input.dosages?.[key]??{};return {...item,sets:integer(dose.sets??item.sets,'sets',1,100),reps:text(String(dose.reps??item.reps),'reps',100),holdSeconds:integer(dose.holdSeconds??item.holdSeconds,'hold_seconds',0,600),frequency:text(dose.frequency??item.frequency,'frequency',100)}})
 const at=now(),assigned=chosen.map(item=>({item,key:id()}))
 await commit(db,who,[clientAuthority(db,who,client.id),guard(db,"EXISTS(SELECT 1 FROM bm_notes WHERE id=? AND client_id=? AND (?='owner' OR author_id=?))",noteId,client.id,who.role,practitionerId(who)??''),
 ...assigned.map(({item:e,key})=>stmt(db,`INSERT INTO bm_home_exercises(id,client_id,title,sets,reps,frequency,instructions,image,assigned_by,assigned_at,source_note_id,hold_seconds,library_id,instructions_es,title_es,exercise_license,exercise_source)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,client.id,e.title,e.sets,e.reps,e.frequency,e.instructions,e.image,who.email,at,noteId,e.holdSeconds,e.id,e.instructionsEs,e.titleEs,e.license,e.source)),...assigned.map(({key})=>audit(db,who,'exercise.assigned',client.id,key))])
 return {ids:assigned.map(v=>v.key),noteId}
}
