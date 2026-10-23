// Independent conformance proof for the actual production serializer. Public-door
// workflows are proven separately by cob-journey.mjs; no application state is faked.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const output=resolve(process.env.BALM_COB_VALIDATION??'.cache/cob-validator')
await mkdir(output,{recursive:true})
await build({entryPoints:['src/balm/insurance/professional.ts'],outfile:output+'/professional.mjs',bundle:true,format:'esm',platform:'node',target:'es2023'})
const {professionalBatch}=await import(pathToFileURL(output+'/professional.mjs'))
const line={code:'97110',minutes:15,units:1,modifiers:['GP'],amountCents:9500,diagnosisPointers:[1]}
const payer=(id,name)=>({id,name,code:id,receiver:id,medicare:false,unitMethod:'cms'})
const subscriber={first:'Synthetic',last:'Balm',dob:'1988-04-02',sex:'F',relationship:'18',memberId:'synthetic-balm-1',group:''}
const c={patient:{first:'Synthetic',last:'Balm',dob:'1988-04-02',sex:'F'},subscriber,address:{street:'200 Oak St',city:'Austin',state:'TX',postal:'78701'},payer:payer('99992','Synthetic secondary'),billing:{name:'Synthetic clinic',npi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postal:'78701',sender:'SYNTHETIC',contact:'Billing desk',phone:'5125550100',production:false},rendering:{first:'Priya',last:'Shah',npi:'1234567893',taxonomy:'225100000X',enrolled:true},referring:null,authorization:null,serviceDate:'2026-10-20',diagnoses:['M25.561'],lines:[line],signedNotes:[],invoiceId:'synthetic-balm-2',invoiceCents:9500,attended:true,requiresReferral:false,kx:{required:false,thresholdCents:null,usedCents:0,projectedCents:9500,group:'pt_slp',year:2026},medicalNecessity:'',frequency:'1',originalControl:''}
const primary={policyId:'synthetic-balm-3',priority:1,payer:payer('99991','Synthetic primary'),subscriber,paidCents:6000,payerControl:'synthetic-balm-4',lines:[{...line,chargeCents:9500,paidCents:6000,adjustments:[{group:'CO',reason:'45',amountCents:2000},{group:'PR',reason:'3',amountCents:1500}],adjudicatedOn:'2026-10-21'}],adjustments:[],sourceId:'synthetic-balm-5',sourceKind:'835'}
for(const priority of [2,3]){
 const prior=[primary]
 if(priority===3)prior.push({...primary,policyId:'synthetic-balm-6',priority:2,payer:c.payer,paidCents:1000,payerControl:'synthetic-balm-7',lines:[{...primary.lines[0],paidCents:1000,adjustments:[{group:'CO',reason:'45',amountCents:8000},{group:'PR',reason:'3',amountCents:500}],adjudicatedOn:'2026-10-22'}]})
 const body=professionalBatch([{id:'synthetic-balm-8',snapshot:{...c,payer:priority===3?payer('99993','Synthetic tertiary'):c.payer,cob:{priority,prior,primaryUnits:[{code:'97110',units:1}]}}}],'synthetic-balm-9')
 assert.match(body,/SVD\*99991\*60.00\*HC:97110:GP\*\*1/)
 await writeFile(output+`/${priority===2?'secondary':'tertiary'}.x12`,body)
}
console.log('ACTUAL_837P_OUTPUT='+output)
