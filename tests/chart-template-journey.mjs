import assert from 'node:assert/strict'
import { pastVisit } from './clinic.mjs'

export const clinicalGoals = () => [
  { id:'short-1',term:'short',text:'Synthetic short-term functional goal',target:'Perform 8 of 10 trials independently',deadline:'Within 2 weeks',status:'not_met' },
  { id:'long-1',term:'long',text:'Synthetic long-term functional goal',target:'Perform 10 of 10 trials independently',deadline:'Within 6 weeks',status:'not_met' },
]
/** Explicit synthetic clinical fixture, used only where a test needs complete care documentation. */
export function chartFixture(kind='daily',discipline='pt') {
  const sections = { subjective:'Synthetic patient report for this visit',objective:'Synthetic measured performance and skilled intervention',assessment:'Synthetic clinical assessment for this visit',goals:'Synthetic goal review',plan:'Synthetic plan for next visit',diagnosis:'M25.561',response:'Synthetic patient response to treatment',period:'Synthetic reporting period',reason:'Synthetic goals achieved',condition:'Synthetic presenting condition',onset:'Synthetic onset and mechanism',prior_function:'Synthetic prior independent function',medical_history:'Synthetic reviewed medical history',medications:'Synthetic reviewed medication list',systems_review:'Synthetic completed systems review',rom:'Synthetic ROM assessment',strength:'Synthetic strength assessment',special_tests:'Synthetic special tests',gait_balance:'Synthetic gait and balance assessment',adl_iadl:'Synthetic ADL and IADL assessment',upper_extremity:'Synthetic upper-extremity and fine motor assessment',cognition:'Synthetic cognition screen',standardized_assessment:'Synthetic standardized communication assessment',prognosis:'Good',frequency:'Twice weekly',duration:'Six weeks',planned_interventions:'Synthetic skilled interventions',comparison:'Synthetic objective comparison with evaluation',skilled_need:'Synthetic continued skilled-care rationale',final_measures:'Synthetic final measures compared with evaluation',home_program:'Synthetic independent home program' }
  const code = kind==='evaluation' ? {pt:'97161',ot:'97165',slp:'92523'}[discipline] : kind==='reevaluation' ? {pt:'97164',ot:'97168',slp:'92523'}[discipline] : {pt:'97110',ot:'97535',slp:'92507'}[discipline]
  return { sections, clinical:{goals:clinicalGoals(),precautions:'Synthetic precaution: protect the involved region'},charges:[{code,minutes:30,parameters:'Synthetic graded functional task, 2 sets of 10 trials'}],totalTimedMinutes:discipline==='slp'||kind==='evaluation'||kind==='reevaluation'?0:30,totalTreatmentMinutes:30 }
}

export async function templateJourney(h) {
  await h.finishSetup()
  await h.cmd('settings.save',{clinicName:'synthetic-balm-1',timeZone:'Australia/Brisbane',taxId:'12-3456789',address:'synthetic-balm-1'})
  const service=await h.cmd('service.save',{name:'synthetic-balm-1',durationMinutes:45,priceCents:9500})
  const results=[]
  for (const [index,discipline] of ['pt','ot','slp'].entries()) {
    const name=`synthetic-balm-${index+1}`
    const clinician=await h.staff(name,'practitioner',{discipline,credentials:discipline.toUpperCase()})
    await h.cmd('hours.save',{practitionerId:clinician.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
    const patient=await h.cmd('client.save',{firstName:name,lastName:'synthetic-balm-1',dateOfBirth:'1980-01-01'})
    const episode=await h.cmd('episode.open',{clientId:patient.id,title:name,directAccess:true})
    const signature=(note,revision=1,status=200)=>h.cmd('note.sign',{id:note.id,revision,signature:name,credentials:discipline.toUpperCase(),attest:true},clinician.cookie,status)
    const file=async()=> (await h.send('/api/balm/clients/'+patient.id,undefined,clinician.cookie)).value
    const evalVisit=await pastVisit(h,patient.id,clinician,service.id,h.owner,18,{episodeId:episode.id})
    const evaluationFixture=chartFixture('evaluation',discipline)
    const evaluation=await h.cmd('note.write',{clientId:patient.id,appointmentId:evalVisit,template:`${discipline}.evaluation`,...evaluationFixture,clinical:{...evaluationFixture.clinical,goals:[]}},clinician.cookie)
    const noGoals=await signature(evaluation,1,400);assert.match(noGoals.message ?? noGoals.code,/goals/i)
    await h.cmd('note.amend',{id:evaluation.id,revision:1,...evaluationFixture},clinician.cookie)
    await h.cmd('note.measure',{noteId:evaluation.id,kind:'flowsheet',name:'synthetic-balm-1',value:'10',unit:'lb',sets:2,reps:10},clinician.cookie)
    await signature(evaluation,2)
    const originals=[(await file()).notes.find(n=>n.id===evaluation.id)]
    // A later-signed record in another episode and a later service date in this
    // episode must never contaminate the earlier daily visit's carried facts.
    const otherEpisode=await h.cmd('episode.open',{clientId:patient.id,title:'synthetic-balm-4',directAccess:true})
    for(const [hours,episodeId] of [[17,otherEpisode.id],[2,episode.id]]) {
      const separateVisit=await pastVisit(h,patient.id,clinician,service.id,h.owner,hours,{episodeId})
      const separate=chartFixture('evaluation',discipline)
      separate.sections.diagnosis='M54.50';separate.sections.plan='Synthetic separate visit plan'
      separate.clinical.goals[0].text='Synthetic separate goal'
      const separateNote=await h.cmd('note.write',{clientId:patient.id,appointmentId:separateVisit,template:`${discipline}.evaluation`,...separate},clinician.cookie)
      await signature(separateNote)
    }
    for(let day=0;day<3;day++) {
      const visit=await pastVisit(h,patient.id,clinician,service.id,h.owner,16-day*2,{episodeId:episode.id})
      const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:`${discipline}.daily`},clinician.cookie)
      const draft=(await file()).notes.find(n=>n.id===note.id).revisions[0]
      const section=id=>draft.sections.find(s=>s.id===id)?.text
      assert.equal(section('subjective'),'');assert.equal(section('assessment'),'')
      assert.equal(section('diagnosis'),'M25.561');assert.match(section('plan'),/Synthetic plan/)
      assert.equal(draft.clinical.goals.length,2);assert.equal(draft.clinical.goals[0].text,'Synthetic short-term functional goal');assert.match(draft.clinical.precautions,/Synthetic precaution/)
      assert.equal(draft.clinical.flowsheet[0].value,10)
      const complete=chartFixture('daily',discipline)
      await h.cmd('note.amend',{id:note.id,revision:1,...complete,charges:complete.charges.map(c=>({...c,minutes:0}))},clinician.cookie)
      const noMinutes=await signature(note,2,400);assert.match(noMinutes.message ?? noMinutes.code,/minutes.*intervention|intervention.*minutes/i)
      await h.cmd('note.amend',{id:note.id,revision:2,...complete},clinician.cookie)
      await signature(note,3)
      originals.push((await file()).notes.find(n=>n.id===note.id))
      if(day===0&&process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:`CHART-002-${discipline}-daily`,path:'/app/clients/'+patient.id,cookie:clinician.cookie,selector:'text=Goals and status'}])}
    }
    for(const [n,kind] of ['progress','reevaluation','discharge'].entries()) {
      const visit=await pastVisit(h,patient.id,clinician,service.id,h.owner,10-n*2,{episodeId:episode.id})
      const complete=chartFixture(kind,discipline);complete.clinical.goals[0].status='met';complete.clinical.goals[1].status='partly_met'
      const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:`${discipline}.${kind}`,...complete},clinician.cookie)
      await signature(note)
      const stored=(await file()).notes.find(n=>n.id===note.id)
      assert.deepEqual(stored.revisions[0].clinical.goals.map(g=>g.status),['met','partly_met'])
      originals.push(stored)
    }
    results.push({patient,clinician,episode,originals})
  }
  return results
}

export async function customizedTemplateJourney(h) {
  const results=await templateJourney(h)
  const {patient,clinician,episode}=results[0]
  const input={baseKey:'pt.daily',title:'synthetic-balm-1 knee daily',bodyRegion:'Lower extremity',diagnosisVariant:'M25.561',customFields:[{id:'assistance',label:'Functional assistance',required:true,choices:['Independent','Assisted']}]}
  const custom=await h.cmd('template.save',input)
  const visit=await pastVisit(h,patient.id,clinician,(await h.state()).services[0].id,h.owner,1,{episodeId:episode.id})
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:custom.id,...chartFixture()},clinician.cookie)
  const sign={id:note.id,revision:1,signature:clinician.name ?? 'synthetic-balm-1',credentials:'PT',attest:true}
  const missing=await h.cmd('note.sign',sign,clinician.cookie,400);assert.match(missing.message ?? missing.code,/Functional assistance/)
  await h.cmd('note.amend',{id:note.id,revision:1,...chartFixture(),sections:{...chartFixture().sections,assistance:'Unsupported'}},clinician.cookie,400)
  await h.cmd('note.amend',{id:note.id,revision:1,...chartFixture(),sections:{...chartFixture().sections,assistance:'Independent'}},clinician.cookie)
  await h.cmd('note.sign',{...sign,revision:2},clinician.cookie)
  const read=async()=> (await h.send('/api/balm/clients/'+patient.id,undefined,clinician.cookie)).value
  const original=(await read()).notes.find(n=>n.id===note.id)
  await h.cmd('template.save',{...input,id:custom.id,version:custom.version,title:'synthetic-balm-1 revised daily',customFields:[...input.customFields,{id:'review',label:'Additional practice review',required:true}]})
  assert.deepEqual((await read()).notes.find(n=>n.id===note.id),original)
  for (const result of results) {
    const current=(await h.send('/api/balm/clients/'+result.patient.id,undefined,result.clinician.cookie)).value.notes
    for(const before of result.originals) assert.deepEqual(current.find(n=>n.id===before.id),before,'signed note bytes and metadata remain unchanged')
  }
  await h.cmd('template.save',input,clinician.cookie,403)
  const reception=await h.staff('synthetic-balm-4','reception')
  const billing=(await h.send('/api/balm/clients/'+patient.id,undefined,reception.cookie)).value
  assert.equal(billing.notes,null)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-002-template-versions',path:'/app/clinic',cookie:h.owner,selector:'text=Clinical templates'}])}
  await templateBrowserJourney(h,results[0])
}

/** Real template, compose, edit and sign forms. Opt-in with the existing viewport receipt switch. */
export async function templateBrowserJourney(h, result) {
  if(!process.env.BALM_UI_SCREENSHOTS)return
  const {chromium}=await import('@playwright/test')
  const {mkdir}=await import('node:fs/promises')
  await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    const context=await browser.newContext({ignoreHTTPSErrors:true})
    for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
    await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
    const page=await context.newPage()
    const signIn=async cookie=>{await context.clearCookies();const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true}])}
    const shot=async(name,width,locator)=>{
      await locator.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
      await page.screenshot({path:`${process.env.BALM_UI_SCREENSHOTS}/${name}-${width}.png`})
    }
    const {patient,clinician,episode}=result
    const service=(await h.state()).services[0]
    for(const [i,width] of [1440,390].entries()) {
      await page.setViewportSize({width,height:1000})
      await signIn(h.owner);await page.goto(h.origin+'/app/clinic')
      await page.getByText('Add a practice template',{exact:true}).click()
      const edit=page.locator('form[action*="template.save"]').last()
      await edit.locator('[name=baseKey]').selectOption('pt.daily')
      const title=`synthetic-balm-${width}`
      await edit.locator('[name=title]').fill(title)
      await edit.locator('[name=bodyRegion]').selectOption('Lower extremity')
      await edit.locator('[name=diagnosisVariant]').fill('M25.561')
      await edit.getByText('Practice element 1',{exact:true}).click()
      await edit.locator('[name=custom_0_id]').fill('assistance')
      await edit.locator('[name=custom_0_label]').fill('Functional assistance')
      await edit.locator('[name=custom_0_choices]').fill('Independent\nAssisted')
      await edit.locator('[name=custom_0_required]').check()
      await shot('CHART-002-template-form',width,edit)
      await Promise.all([page.waitForNavigation(),edit.getByRole('button',{name:'Create template',exact:true}).click()])
      const t=(await h.state()).clinicalTemplates.find(t=>t.title===title);assert.ok(t)
      const visit=await pastVisit(h,patient.id,clinician,service.id,h.owner,3+i,{episodeId:episode.id})
      await signIn(clinician.cookie)
      await page.goto(h.origin+`/app/clients/${patient.id}?compose=${visit}&template=${t.key}`)
      let form=page.locator('form[data-actor-id]').filter({has:page.locator('[name=clientId]')}).last()
      assert.equal(await form.locator('[name=section_subjective]').inputValue(),'')
      assert.equal(await form.locator('[name=section_assessment]').inputValue(),'')
      assert.equal(await form.locator('[name=section_diagnosis]').inputValue(),'M25.561')
      assert.ok(await form.locator('[name=goal_0_text]').inputValue())
      assert.match(await form.locator('[name=precautions]').inputValue(),/Synthetic precaution/)
      await shot('CHART-002-compose-carried',width,form)
      const complete=chartFixture()
      for(const section of t.sections){const control=form.locator(`[name="section_${section.id}"]`);if(section.id==='assistance')await control.selectOption('Independent');else if(section.choices?.length)await control.selectOption(complete.sections[section.id] ?? '');else await control.fill(complete.sections[section.id] ?? '')}
      await form.locator('[name=charge_code_0]').selectOption('97110')
      await form.locator('[name=charge_minutes_0]').fill('30')
      await form.locator('[name=charge_parameters_0]').fill('Synthetic graded task, 2 sets of 10 trials')
      await form.locator('[name=totalTimedMinutes]').fill('30');await form.locator('[name=totalTreatmentMinutes]').fill('30')
      await Promise.all([page.waitForNavigation(),form.getByRole('button',{name:'Save draft',exact:true}).click()])
      const notes=(await h.send('/api/balm/clients/'+patient.id,undefined,clinician.cookie)).value.notes
      const note=notes.find(n=>n.appointmentId===visit);assert.ok(note)
      const entry=page.locator('#note-'+note.id)
      await entry.getByText('Review and sign',{exact:true}).click()
      const signing=entry.locator('form[action*="note.sign"]')
      await signing.locator('[name=signature]').fill('synthetic-balm-1')
      await signing.locator('[name=credentials]').fill('PT')
      await signing.locator('[name=attest]').check()
      await shot('CHART-002-review-sign',width,signing)
      await Promise.all([page.waitForNavigation(),signing.getByRole('button',{name:'Sign note',exact:true}).click()])
      const signed=(await h.send('/api/balm/clients/'+patient.id,undefined,clinician.cookie)).value.notes.find(n=>n.id===note.id)
      assert.equal(signed.status,'signed')
      await shot('CHART-002-signed',width,page.locator('#note-'+note.id))
    }
  }finally{await browser.close()}
}
