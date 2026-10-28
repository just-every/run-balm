export const readinessFacts = { privacyOfficer:'Synthetic Privacy Officer',securityOfficer:'Synthetic Security Officer',riskAnalysis:'synthetic-balm-901 controlled risk worksheet; reviewed access, storage, transport and recovery risks',riskReviewedOn:'2026-10-01',encryptionAtRest:'synthetic-balm-902 owner-reviewed encrypted storage',encryptionInTransit:'synthetic-balm-903 owner-reviewed TLS',attest:true }
export async function recordTestBaa(h,processor) {
 return h.cmd('readiness.baa.record',{processor,provider:'synthetic-balm-904 '+processor,plan:processor==='sms'?'Twilio Security':'synthetic-balm-905 covered plan',reference:'synthetic-balm-906 signed agreement',signedOn:'2026-09-01',attest:true})
}
export async function readinessFixture(h) {
 for(const processor of ['mail','sms','scribe','backups','clearinghouse'])await recordTestBaa(h,processor)
 await h.cmd('readiness.save',readinessFacts)
}

export const hostingProfile = {provider:'cloudflare',account:'synthetic-balm-920',deployment:'synthetic-balm-921',services:['workers','d1','r2']}
export async function hostingFixture(h, overrides={}) {
 const hosting=await recordTestBaa(h,'hosting')
 const backups=await recordTestBaa(h,'backups')
 const facts={...hostingProfile,coveredServices:['workers','d1','r2'],serviceEvidence:{workers:'synthetic-balm-922 eligibility',d1:'synthetic-balm-923 eligibility',r2:'synthetic-balm-924 eligibility'},baaId:hosting.id,backupBaaId:backups.id,qualificationReference:'synthetic-balm-925 qualification',backupReceipt:'synthetic-balm-926 locked encrypted backup',drillReceipt:'synthetic-balm-927 drill',attest:true,...overrides}
 const record=await h.cmd('hosting.record',facts)
 return {...record,facts,baaId:hosting.id,backupBaaId:backups.id}
}
export const patientMode = (mode,id) => ({mode,id,reason:'Synthetic hosting journey; no live qualification',attest:true})
