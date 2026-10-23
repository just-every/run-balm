import { empty, entry, field, form, h, hidden, panel, select, stamp, textarea } from './shared'

/** Staff author patient-specific programs; clinical reads are scoped before rendering. */
export function portalChartPanel(state: any, file: any) {
  if (!file.homeExercises) return ''
  const path = `/app/clients/${file.client.id}`
  const assignments = file.homeExercises.map((e: any) => entry(e.title,
    `<p>${h(e.sets)} sets · ${h(e.reps)} reps · Hold ${h(e.holdSeconds??0)} seconds · ${h(e.frequency)}</p><p class="secure-body">${h(e.instructions)}</p>`
    + (e.image ? `<img class="exercise-image" src="${h(e.image)}" alt="${h(e.title)}">` : '')
    + `<p class="help">${e.seenAt ? `Opened ${stamp(state, e.seenAt)}.` : 'Not opened yet.'} ${e.doneDates?.length ? `Completed on ${e.doneDates.map((d: string) => h(d)).join(', ')}.` : 'No completion logged yet.'}</p>`
    + (e.sessions?.length?'<p>Session pain: '+e.sessions.map((x:any)=>h(x.day)+' · '+(x.pain===null?'not recorded':h(x.pain)+'/10')).join('; ')+'</p>':'')
    + (!e.archivedAt ? form('exercise.archive', path, hidden('id', e.id), 'Archive exercise', true) : '<p>Archived</p>'))).join('')
  const assign = `<form method="post" enctype="multipart/form-data" action="/app/action?name=exercise.assign&amp;returnTo=${encodeURIComponent(path)}">${hidden('clientId', file.client.id)}
    ${field('title', 'Exercise name', '', 'text', 'required maxlength="160"')}
    <div class="pair">${field('sets', 'Sets', 3, 'number', 'required min="1" max="50"')}${field('reps', 'Reps', 10, 'number', 'required min="1" max="500"')}</div>
    ${field('holdSeconds','Hold (seconds)',0,'number','min="0" max="600"')}${field('frequency','Frequency','Daily','text','required maxlength="100"')}
    ${textarea('instructions', 'Instructions and frequency', '', 'required maxlength="5000"')}
    <label>Instruction image (optional, PNG, JPEG or WebP, up to 1 MB)<input type="file" name="exerciseImage" accept="image/png,image/jpeg,image/webp"></label>
    <button type="submit">Assign exercise</button></form>`
  return panel('Home exercise program', `<p>Patients open their home program, visits, forms, messages and statements at <a href="/portal">the patient portal</a>, using an emailed sign-in link.</p>${assignments || empty('No home exercises assigned yet.')}<details><summary>Assign an exercise</summary>${assign}</details>`, 'full')+libraryPanel(state,file)
}


export function noteProgram(s:any,f:any,n:any){
 const list=(f.homeExercises??[]).filter((e:any)=>!e.archivedAt)
 const adherence=list.length?'<h4>Home program adherence</h4>'+list.map((e:any)=>`<p>${h(e.title)} · ${e.doneDates.length} sessions${e.sessions?.length?' · '+e.sessions.map((d:any)=>h(d.day)+(d.pain===null?'':' pain '+h(d.pain)+'/10')).join('; '):''}</p>`).join(''):''
 if(!n.mine)return adherence
 const path='/app/clients/'+f.client.id
 return adherence+`<details><summary>Assign an exercise from this note</summary>${form('exercise.assign',path,hidden('clientId',f.client.id)+hidden('noteId',n.id)+field('title','Exercise name','','text','required maxlength="160"')+field('sets','Sets',3,'number','required min="1" max="100"')+field('reps','Repetitions','10','text','required maxlength="100"')+field('holdSeconds','Hold (seconds)',0,'number','min="0" max="600"')+field('frequency','Frequency','Daily','text','required maxlength="100"')+textarea('instructions','Instructions','','required maxlength="10000"'),'Assign exercise from note')}</details>`
}

export function libraryPanel(s:any,f:any){
 const d=f.exerciseLibrary
 if(!d)return ''
 const path='/app/clients/'+f.client.id
 const search=`<form method="get" action="${h(path)}">${field('q','Search words',d.query.q,'search','maxlength="200"')}${select('discipline','Discipline',[['','All'],['pt','Physical therapy'],['ot','Occupational therapy'],['slp','Speech-language pathology']],d.query.discipline)}${select('region','Body region',[['','All'],...d.regions.map((v:string)=>[v,v])],d.query.region)}${select('equipment','Equipment',[['','All'],...d.equipment.map((v:string)=>[v,v])],d.query.equipment)}<button type="submit">Search exercises</button></form>`
 const list=d.exercises.map((e:any)=>`<article class="entry"><label class="check"><input name="exercise_${h(e.id)}" type="checkbox" value="on"><span><strong>${h(e.title)}</strong></span></label><p>${h(e.discipline.toUpperCase())} · ${h(e.region)} · ${h(e.position)} · ${h(e.equipment)}</p><img class="exercise-image" src="${h(e.image)}" alt="${h(e.title)} illustration"><p>${h(e.instructions)}</p><p lang="es">${h(e.titleEs)} · ${h(e.instructionsEs)}</p><p>${h(e.license)} · ${h(e.source)}</p><details><summary>Review dosage: ${h(e.title)}</summary>${field('sets_'+e.id,'Sets',e.sets,'number','min="1" max="100" required')}${field('reps_'+e.id,'Repetitions',e.reps,'text','maxlength="100" required')}${field('hold_'+e.id,'Hold (seconds)',e.holdSeconds,'number','min="0" max="600" required')}${field('frequency_'+e.id,'Frequency',e.frequency,'text','maxlength="100" required')}</details></article>`).join('')
 const notes=(f.notes??[]).filter((n:any)=>n.mine||s.actor.role==='owner')
 const assign=notes.length?form('exercise.program.assign',path,hidden('clientId',f.client.id)+select('noteId','Assign from note',notes.map((n:any)=>[n.id,n.title+' · '+n.createdAt.slice(0,10)]))+list,'Assign selected home program'):'<p>Save your daily note before assigning a program from the library.</p>'+d.exercises.map((e:any)=>`<p>${h(e.title)} · ${h(e.license)} · ${h(e.source)}</p>`).join('')
 const upload=`<form method="post" enctype="multipart/form-data" action="/app/action?name=exercise.library.import&amp;returnTo=${encodeURIComponent(path)}"><p><a href="https://github.com/just-every/run-balm/blob/main/docs/exercise-library.md">CSV columns and media guide</a></p><label>Exercise CSV<input type="file" name="csv" accept=".csv,text/csv" required></label>${[1,2,3].map(i=>`<label>Image ${i} (PNG, JPEG or WebP, up to 1 MB)<input type="file" name="media_${i}" accept="image/png,image/jpeg,image/webp"${i===1?' required':''}></label>`).join('')}<label class="check"><input name="rights" type="checkbox" required><span>The practice has rights to these exercise instructions and images.</span></label><button type="submit">Import practice exercises</button></form>`
 return panel('Exercise library',`<p>Starter collection: ${h(d.shippedCount)} original CC0 exercises (${h(d.counts.pt)} PT, ${h(d.counts.ot)} OT, ${h(d.counts.slp)} SLP). This is smaller than Balm's planned 1,500-item library. Clinicians must select suitable exercises and review dosage, restrictions and instructions before assigning them.</p>${search}<p>${h(d.total)} matching exercises. At most 100 shown.</p>${assign}<details><summary>Import practice exercises with images</summary>${upload}</details>`,'full','exercise-library')
}
