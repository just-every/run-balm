import { inboxCommand, inboxFor } from './cases/inbox'
import { saveClient } from './domain/clients'
import { hostingCommand } from './domain/hosting'
import { previewRetailDestruction, destroyRetailRecords } from './retention/retail'
import { prepareLetter, editLetter, deliverLetter, lettersFor, previewLetter } from './charting/letters'
import { readinessCommand, readinessState } from './domain/readiness'
import { bookingPaymentResponse } from './payments/booking-prepayment'
import { accountingCommand, accountingView } from './payments/accounting'
import { cardEntryView, intakeCardEntry } from './payments/card-entry'
import { outcomeCommand, outcomesFor } from './cases/outcomes'
import {exerciseLibrary} from './portal/library'
import {guardianCommand,guardianGrants} from './portal/guardians'
import {profileForStaff,reviewProfile} from './portal/profile'
import { integrationCommand, integrationState, requireScope, scopedRead } from './portal/integrations'
import { recordCommand, recordDownload, recordRequests } from './portal/records'
import { codeSetCommand, codeSetStatus } from './codesets'
import { resolveChargeCatalog } from './codesets/charge-catalog'
import { codesetFormInput } from './ui/code-sets'
import {cobPaperDownload} from './insurance/cob-paper'
import {claimWork} from './insurance/claim-work'
import {aeobCommand,aeobsFor,aeobOriginal} from './payments/aeobs'
import {releaseCommand,releasesFor,releasePdf} from './domain/payer-note-releases'
import { estimateCommand, estimateFile, estimateOriginal, pendingEstimates } from './payments/estimates'
import { biller, manager, locationState, locationWrite, roleCommand, roleRead } from './domain/role-access'
import { audit, commit } from './domain/model'
import { takeAddressRate, takeEmailRate, takePatientRate } from './public-rates'
import { saveBookingEmbed } from './domain/clinic'
import { freedVisitOffers, patientChangedNotice } from './scheduling/patient-effects'
import { retentionClient, retentionState, saveRetention, holdRecords, previewDestruction, destroyRecords } from './retention'
import { patientVisitSlots, movePatientAppointment, cancelPatientAppointment } from './scheduling/patient'
import { confirmVisitFee, visitFees } from './scheduling/fees'
import { saveVisitPolicy } from './scheduling/policy'
import { followupCommand, followupSettings, followupsFor } from './followups/settings'
import { clinicalActor, downloadDocument, uploadDocument } from './chart-history/documents'
import { fileHistory } from './chart-history/search'
import { episodeCommand } from './episodes'
import { referralCommand } from './referrals'
import { saveCapacity } from './scheduling/capacity'
import { bookedIntake } from './domain/intake-requests'
import { saveClientAlert, alertsFor } from './domain/alerts'
import { recordDisclosure, disclosuresFor, disclosureReport, accessReport, reportCsv, csvCell } from './domain/disclosures'
import { calendarFeed, feedCommand, feedState } from './domain/calendar-feed'
import { uploadText } from './movein/upload'
import { bundleCommand, bundleJobs, importedForClient } from './movein/bundle'
import { bundleFormInput } from './movein/form-input'
import { ownerProfile, saveOwnerName } from './owner-name'
import { insuredCharge } from './insurance/invoice-price'
import { acknowledgeBreakGlass, breakGlass, careTeamFor, endBreakGlass, grantCareTeam, revokeCareTeam } from './domain/care-team'
import { financialCsv, financialKinds, financialReports, type FinancialKind } from './reports/financial'
import { operationalCsv, operationalReports, reportKinds, type ReportKind } from './reports/operational'
import { outcomeCsv, outcomeReport } from './reports/outcomes'
// Every handler below resolves the actor and enforces its role server-side;
// pages and JSON share the same domain commands. Adapted from Strap's HTTP layer.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { reconciliationCommand } from './payments/reconciliation'
import { approvals, command, preparations, snapshot, type Actor } from './domain'
import { bookingScope, bookOnline, openSlots } from './domain/booking'
import { calendarView } from './domain/calendar'
import { clientFile } from './domain/clients'
import { intakeView, submitIntake } from './domain/intake'
import { invoiceDownload } from './domain/invoices'
import { mailEventResponse } from './mail/events'
import { mailHistory } from './mail/history'
import { logCall } from './messages/calls'
import { communicationHistory, historyAllowed } from './messages/history'
import { sendVisitChange } from './mail/changes'
import { reminderDownload } from './domain/reminders'
import { acceptOffer, offerView, recordDelivery, takenNotices } from './domain/waitlist'
import { certifyPlan, planView, resendPlan, sendPlan } from './domain/plans'
import { sendBooked, sendCanceled, sendIntake, sendPlanLink, sendTaken } from './mail-out'
import { checkDefensibility } from './charting/defensibility'
import { scribeCommand, scribeStatus } from './scribe'
import { backupCommand, backupState } from './backup'
import { importCommand, importOriginal, undoCounts } from './movein'
import { estimateContributorsFromForm, builderRows, editRows, fileFromField, hoursFromForm, questionsFromRows } from './forms'
import { plain } from './refusals'
import { hostDateAt } from './availability/timezone'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { clientBilling, paymentCommand, paymentsState } from './payments'
import { parseDollars } from './payments/ledger'
import { WEBHOOK_PATH } from './payments/connect'
import { paymentDocument, paymentsPublicResponse } from './payments/http'
import { renderApp, renderPublic } from './ui'
import { agentOpenApi } from './agent-openapi'
import { insuranceCommand, insuranceState, insuranceFile, insuranceDownload, bookingWarnings } from './insurance'
import { DomainError, human, insist, need, one, sha256 } from './domain/model'
import { daySheetCsv, daySheetHtml } from './ui/day-sheet'
import {payerEobDownload} from './insurance/manual-payers'
import {manualPayerForm} from './insurance/manual-payer-forms'
import { clinicAttachment, linkAttachment, uploadField } from './messages/attachments'
import { parseMessageInput } from './messages/input'
import { messageCommand, messageFile, patientMessages, patientSend } from './messages'
import { reminderSettings, reminderCommand, reminderHistory } from './reminders/settings'
import { visitReply, visitReplyView } from './reminders/replies'
import { portalResponse } from './portal/http'
import { portalCommand, portalExercisesFor } from './portal'
import { consentDocument, insuranceAiStatus, insurancePhoto, identityPhoto, intakeChart, parseIntakeInput, readInsurance, verifyInsurance } from './intake'
import { consentView, requestConsents, signRenewals } from './intake/renewals'
import { caseCommand, caseList } from './cases'
import { visitSummary } from './visit-summary'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = /^\/app(\/clients(\/[\w-]+)?|\/invoices|\/clinic|\/intake|\/import|\/agent|\/waitlist|\/insurance|\/cases|\/reports)?$/
const redirect = (location: string) => new Response(null, { status: 303, headers: { ...headers, location } })

async function state(env: Bindings, who: Actor) {
  if (manager(who)) return locationState(env.DB,who)
  const jobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='balm:clients' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const importJobs = await Promise.all(jobs.map(async (j: any) => j.state === 'undone' ? { ...j, undo: await undoCounts(env.DB, who, j.id) } : j))
  return { readiness:who.role==='owner'?await readinessState(env,who):null, accounting:await accountingView(env,who), integrations:await integrationState(env.DB,who), recordRequests: await recordRequests(env.DB,who), codeSets: who.role==='owner' ? await codeSetStatus(env.DB) : undefined, billingCodeCatalog: who.role==='owner'||who.staffRole==='practitioner' ? await resolveChargeCatalog(env.DB) : [], pendingEstimates: await pendingEstimates(env.DB,who), retention: who.role === 'owner' ? await retentionState(env.DB, who) : null, visitFees: await visitFees(env.DB, who), followups: await followupSettings(env.DB, who), calendarFeed: await feedState(env.DB, who), ...await snapshot(env.DB, who), ...await paymentsState(env, env.DB, who), agentKeys: await agentKeys(env, who), origin: env.AUTH_ORIGIN, importJobs, moveinJobs: who.role === 'owner' ? await bundleJobs(env.DB) : [], local: env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1', scribe: await scribeStatus(env, who), backups: await backupState(env, who), reminders: await reminderSettings(env, who), me: await ownerProfile(env.DB, who), insurance: who.role === 'agent' ? undefined : await insuranceState(env, who) }
}

/** A client file as the pages show it: the audited file plus its billing. */
async function fileFor(env: Bindings, who: Actor, clientId: string, auditBefore?: string, historyInput: Record<string, unknown> = {}) {
  const file = await clientFile(env.DB, who, clientId, auditBefore)
  const zone = (await env.DB.prepare('SELECT time_zone FROM bm_settings WHERE id=1').first<{time_zone:string}>())!.time_zone
  // CHART-013 care-team access alone opens the notes (and documents under break glass), not the rest of the file.
  if (file.careAccess.teamOnly) return { ...file, chartHistory: await fileHistory(env.DB, who, file, zone, historyInput) }
  const cancellations = (await env.DB.prepare('SELECT * FROM bm_visit_cancellations WHERE appointment_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(file.appointments.map(a => a.id))).all<any>()).results
  for (const appointment of file.appointments) appointment.cancellation = cancellations.find(c => c.appointment_id === appointment.id)
  const composeVisit = file.appointments.find(a=>a.id===historyInput.compose)
  const composedDate = composeVisit ? hostDateAt(new Date(composeVisit.start_at as string),zone) : undefined
  const enriched = { ...file, inbox: await inboxFor(env.DB,who,clientId), communications: historyAllowed(who) ? ('communicationQuery' in historyInput || 'communicationChannel' in historyInput ? await communicationHistory(env.DB, who, clientId, historyInput) : { query: '', channel: '', total: null, results: [], limit: 50 }) : null, letters: await lettersFor(env.DB,who,clientId), outcomeFollowthrough: file.careAccess?.teamOnly || file.careAccess?.supervisionOnly ? null : await outcomesFor(env.DB, who, clientId, env.AUTH_ORIGIN), guardianGrants:await guardianGrants(env.DB,who,clientId),portalProfileChanges:await profileForStaff(env.DB,who,clientId), billingCodeCatalog: who.role==='owner'||who.staffRole==='practitioner' ? await resolveChargeCatalog(env.DB,composedDate) : [], noteReleases: await releasesFor(env.DB,who,clientId), estimates: await estimateFile(env.DB,who,clientId), aeobs:who.role==='owner'?await aeobsFor(env.DB,clientId):null, retention: who.role === 'owner' ? await retentionClient(env.DB, who, clientId) : null, followups: await followupsFor(env.DB, who, clientId), alerts: await alertsFor(env.DB, who, file.client.id as string), disclosures: await disclosuresFor(env.DB, who, file.client.id as string), imported: await importedForClient(env.DB, who, file.client.id as string), insurance: who.role === 'agent' ? undefined : await insuranceFile(env.DB, who, file.client.id as string), intakeDocuments: { ...await intakeChart(env.DB, who, file.client.id as string), ai: await insuranceAiStatus(env) }, billing: await clientBilling(env, env.DB, who, file.client.id as string), messages: await messageFile(env.DB, who, file.client.id as string), exerciseLibrary: who.role==='owner'||who.staffRole==='practitioner' ? await exerciseLibrary(env.DB,who,historyInput):null,homeExercises: who.role === 'owner' || who.staffRole === 'practitioner' ? await portalExercisesFor(env.DB, who, file.client.id as string) : null, mailHistory: await mailHistory(env.DB, file.client.id as string, file.appointments.map(a => a.id as string)), reminderHistory: await reminderHistory(env.DB, file.appointments.map(a => a.id as string)), insuredCharges: Object.fromEntries(await Promise.all(file.appointments.filter(a => a.status === 'attended').map(async a => [a.id, await insuredCharge(env.DB, a.id as string)]))) }
  return { ...enriched, chartHistory: await fileHistory(env.DB, who, enriched, zone, historyInput) }
}

/** One signed-in page: `target` is a page path with an optional calendar query. */
async function page(env: Bindings, who: Actor, target: string, notice: Parameters<typeof renderApp>[2] = {}, status = 200) {
  const [path, query = ''] = target.split('?'), s: any = manager(who) ? await locationState(env.DB,who,Object.fromEntries(new URLSearchParams(query))) : await state(env, who)
  if (manager(who)) return renderApp(s,target,notice,undefined,status)
  if (biller(who) && path === '/app') return redirect('/app/invoices')
  // Until the owner chooses the clinic's time zone, every page is the time zone step.
  if (!s.settings.time_zone) return renderApp(s, target, notice, undefined, status)
  if (path === '/app') {
    s.calendar = await calendarView(env.DB, who, Object.fromEntries(new URLSearchParams(query)))
    if (s.calendar.selected) s.calendar.summary = await visitSummary(env, who, s.calendar.selected.client_id)
  }
  if(path==='/app/insurance'&&(who.role==='owner'||biller(who)))s.insurance.work=await claimWork(env.DB,who,Object.fromEntries(new URLSearchParams(query)))
  if (path === '/app/cases' && (who.role === 'owner' || who.staffRole === 'reception' || who.staffKind==='biller')) s.cases = await caseList(env, who)
  if (path === '/app/reports' && who.role === 'owner') s.reports = await operationalReports(env.DB, who, Object.fromEntries(new URLSearchParams(query)))
    .catch(async error => { s.reportError = message(error).text; return operationalReports(env.DB, who, {}) })
  if (path === '/app/reports' && (who.role === 'owner' || biller(who))) s.financial = await financialReports(env.DB, who, s.reports ? { from: s.reports.from, to: s.reports.to } : {})
  if (path === '/app/reports' && who.role === 'owner') s.outcomes = await outcomeReport(env.DB,who,{...Object.fromEntries(new URLSearchParams(query)),from:s.reports.from,to:s.reports.to})
  const file = path.match(/^\/app\/clients\/([\w-]+)$/)
  const opened = file ? await fileFor(env, who, file[1], notice.ask?.auditBefore, notice.ask).catch(error => {
    // A practitioner outside this chart may open it in an emergency by giving a reason (CHART-013).
    if (who.staffRole === 'practitioner' && error instanceof DomainError && error.status === 404 && status === 200) return { breakGlassOnly: file[1] }
    if (status === 200) throw error
  }) : undefined
  if (opened && 'breakGlassOnly' in opened) return renderApp(s, target, { ...notice, breakGlass: opened.breakGlassOnly }, undefined, 404)
  if (opened && who.role === 'owner') (opened as any).careTeam = await careTeamFor(env.DB, who, file![1])
  return renderApp(s, target, notice, opened, status)
}
/** A same-app page to return to, keeping only a plain calendar query. */
function returnTarget(requested: string) {
  const [path, query] = requested.split('?')
  if (!pages.test(path)) return '/app'
  return query && /^[\w=&%.:-]{1,300}$/.test(query) ? `${path}?${query}` : path
}

async function noticeOthers(env: Bindings, offerId: string) {
  for (const row of await takenNotices(env.DB, offerId)) await recordDelivery(env.DB, offerId, row.entry_id as string, 'taken_notice', await sendTaken(env, row as any))
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  roleCommand(who,name)
  if(name.startsWith('inbox.'))return inboxCommand(env.DB,who,name,input)
  if(name==='call.log')return logCall(env.DB,who,input)
  if(name==='profile.review')return reviewProfile(env.DB,who,input)
  if(name.startsWith('guardian.'))return guardianCommand(env.DB,who,name,input)
  if(name.startsWith('integration.'))return integrationCommand(env,who,name,input)
  if(name.startsWith('record.'))return recordCommand(env.DB,who,name,input)
  if(name.startsWith('codes.'))return codeSetCommand(env.DB,who,name,codesetFormInput(input))
  if(name==='insurance.payer_line.add')input=manualPayerForm(input)
  if(name.startsWith('note_release.'))return releaseCommand(env.DB,who,name,input)
  if(name.startsWith('estimate.aeob.'))return aeobCommand(env.DB,who,name,input)
  if(name==='estimate.prepare'&&input.contributorsForm==='on')input.contributors=estimateContributorsFromForm(input)
  if(name.startsWith('estimate.')) return estimateCommand(env.DB,who,name,input)
  if (name === 'booking.embed.save') return saveBookingEmbed(env.DB, who, input, env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1')
  if (name === 'retention.save') return saveRetention(env.DB, who, input)
  if (name === 'retention.hold') return holdRecords(env.DB, who, input)
  if (name === 'retention.retail.preview') return previewRetailDestruction(env.DB, who, input)
  if (name === 'retention.retail.destroy') return destroyRetailRecords(env.DB, who, input)
  if (name === 'retention.preview') return previewDestruction(env.DB, who, input)
  if (name === 'retention.destroy') return destroyRecords(env.DB, who, input)
  if (name === 'visit_policy.save') return saveVisitPolicy(env.DB, who, input)
  if (name === 'appointment.fee.confirm') return confirmVisitFee(env, env.DB, who, input)
  if (name.startsWith('followups.')) return followupCommand(env.DB, who, name, input)
  if (name === 'letter.prepare') return prepareLetter(env.DB,who,input)
  if (name === 'letter.edit') return editLetter(env.DB,who,input)
  if (name === 'letter.deliver') return deliverLetter(env.DB,who,input)
  if (name === 'chart.document.upload') return uploadDocument(env.DB, who, input)
  if (name.startsWith('episode.')) return episodeCommand(env.DB, who, name, input)
  if (name.startsWith('referral.')) return referralCommand(env.DB, who, name, input)
  if (name === 'capacity.save') return saveCapacity(env.DB, who, input)
  if (name === 'client.alert.save') return saveClientAlert(env.DB, who, input)
  if (name === 'disclosure.record') return recordDisclosure(env.DB, who, input)
  if (name === 'care_team.grant') return grantCareTeam(env.DB, who, input)
  if (name === 'care_team.revoke') return revokeCareTeam(env.DB, who, input)
  if (name === 'chart.break_glass') return breakGlass(env.DB, who, input)
  if (name === 'chart.break_glass.end') return endBreakGlass(env.DB, who, input)
  if (name === 'chart.break_glass.acknowledge') return acknowledgeBreakGlass(env.DB, who, input)
  if (name.startsWith('calendar.feed.')) return feedCommand(env.DB, who, name)
  if(name==='exercise.program.assign'&&!Array.isArray(input.exerciseIds)&&input.exerciseIds===undefined)input.exerciseIds=Object.keys(input).filter(k=>k.startsWith('exercise_')&&input[k]==='on').map(k=>k.slice(9))
  if(name==='exercise.program.assign'&&input.dosages===undefined&&Array.isArray(input.exerciseIds))input.dosages=Object.fromEntries(input.exerciseIds.filter(key=>input['sets_'+key]!==undefined).map(key=>[key,{sets:input['sets_'+key],reps:input['reps_'+key],holdSeconds:input['hold_'+key],frequency:input['frequency_'+key]}]))
  if (name.startsWith('exercise.')) return portalCommand(env.DB, who, name, input)
  if(name==='outcome.enroll'&&!Array.isArray(input.exerciseIds)&&input.exerciseIds===undefined)input.exerciseIds=Object.keys(input).filter(k=>k.startsWith('exercise_')&&input[k]==='on').map(k=>k.slice(9))
  if (name.startsWith('outcome.')) return outcomeCommand(env, who, name, input)
  if (name.startsWith('case.')) return caseCommand(env, who, name, input)
  if (name === 'insurance.verify') return verifyInsurance(env.DB, who, input)
  if (name === 'insurance.read') return readInsurance(env, who, input)
  if (name === 'insurance.supervision.save') return command(env.DB,who,name,input)
  if (name.startsWith('insurance.')) {
    if (['insurance.authorization.save','insurance.authorization_request.decide'].includes(name) && typeof input.cptCodes === 'string') input.cptScope = input.cptCodes.trim() ? input.cptCodes.trim().split(/[,\s]+/) : []
    if (name === 'insurance.batch.prepare' && !Array.isArray(input.claimIds)) input.claimIds = Object.keys(input).filter(k => k.startsWith('claim_') && input[k] === 'on').map(k => k.slice(6))
    if (name === 'insurance.payer.save' && typeof input.feeSchedule === 'string') input.fees = input.feeSchedule.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const [code, amount] = line.trim().split(/\s+/)
      return { code, cents: parseDollars(amount, 'fee') }
    })
    if (name === 'insurance.eligibility.record' && typeof input.copay === 'string') input.copayCents = input.copay.trim() ? parseDollars(input.copay, 'copay') : null
    if (name === 'insurance.medicare.save' && input.threshold !== undefined) { input.thresholdCents = parseDollars(input.threshold, 'threshold'); input.externalUsedCents = parseDollars(input.externalUsed || '0', 'outside_expenses') }
    return insuranceCommand(env, who, name, input)
  }
  if (['appointment.book', 'series.book'].includes(name)) {
    need(who, 'owner', 'reception', 'practitioner'); human(who)
    insist(who.role === 'owner' || who.staffRole === 'reception' || input.practitionerId === who.staffId, 'practitioners_book_their_own_diary', 403)
    // The booker's patient scope, and a location manager's location, come before any warning reads the patient's coverage.
    await bookingScope(env.DB, who, String(input.clientId ?? ''))
    await locationWrite(env.DB, who, input.roomId, input.clientId)
    const dates = name === 'series.book'
      ? (Array.isArray(input.occurrences) ? input.occurrences.filter((o: any) => ![true, 'on', 'yes'].includes(o.skip)).map((o: any) => String(o.date))
        : Object.keys(input).filter(k => /^date_\d+$/.test(k) && input['skip_' + k.slice(5)] !== 'on').map(k => String(input[k])))
      : [String(input.date ?? '')]
    const found = (await Promise.all([...new Set(dates)].map(date => bookingWarnings(env.DB, String(input.clientId), date, String(input.practitionerId ?? ''), undefined, dates, input.episodeId ? String(input.episodeId) : undefined)))).flat()
    const warnings = [...new Map(found.map(w => [w.code + ':' + w.authorizationId + ':' + w.policyId, w])).values()]
    if (warnings.some(w => w.blocking) || (warnings.length && input.acknowledgeInsurance !== 'on' && input.acknowledgeInsurance !== true))
      throw new DomainError('Review the insurance authorization warnings before booking.', 409, { insuranceBooking: { name, input, warnings } })
  }
  if (name === 'client.save') return saveClient(env.DB,who,input,env)
  if (name.startsWith('hosting.')) return hostingCommand(env,who,name,input)
  if (name.startsWith('readiness.')) return readinessCommand(env.DB,who,name,input)
  if (name === 'owner.name') return saveOwnerName(request, env, who, input)
  if (name.startsWith('accounting.')) return accountingCommand(env,who,name,input)
  if (name.startsWith('finance.')) return reconciliationCommand(env.DB,who,name,input)
  if (name.startsWith('agent.') || name === 'staff.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('message.')) return messageCommand(env, who, name, input)
  if (name.startsWith('reminders.')) return reminderCommand(env, who, name, input)
  if (name.startsWith('pay.')) return paymentCommand(env, env.DB, who, name, input)
  if (name.startsWith('movein.')) return bundleCommand(env.DB, who, name, input, env)
  if (name.startsWith('import.')) {
    if (who.role !== 'owner') fail('only_the_owner_imports', 403)
    return importCommand(env.DB, who, name, input, env)
  }
  if (name === 'note.check') return checkDefensibility(env, who, input)
  if (name.startsWith('scribe.') || name === 'note.scribe') return scribeCommand(env, who, name, input)
  if (name.startsWith('backup.')) return backupCommand(env, who, name, input)
  if (name === 'plan.send' || name === 'plan.resend') {
    const plan = await (name === 'plan.send' ? sendPlan : resendPlan)(env.DB, who, input)
    return { ...plan, mail: await sendPlanLink(env, plan.physicianEmail, plan.token) }
  }
  if (name === 'consent.request') return requestConsents(env, who, input)
  const result: any = await command(env.DB, who, name, input)
  if (name === 'appointment.book' || name === 'series.book') {
    // A past visit emails nothing; a client with intake on file, or an open link already, is not asked again.
    const booked = name === 'series.book' ? result.appointmentIds : [result.appointmentId], clientId = String(input.clientId)
    result.intake = await bookedIntake(env.DB, clientId, result.appointmentId, result.startAt, booked)
    result.mail = result.intake === 'ask' ? await sendIntake(env, clientId, result.token, result.startAt, undefined, booked)
      : result.intake === 'past' ? 'not_sent' : await sendBooked(env, clientId, result.startAt, booked.length, booked)
    if (result.intake !== 'ask') delete result.token
  }
  if (name === 'appointment.move' || name === 'series.move_rest') {
    const changed = name === 'appointment.move' ? [result.id] : result.appointmentIds
    result.mail = await sendVisitChange(env, changed, 'moved')
  }
  if (name === 'appointment.cancel' || name === 'series.cancel_rest') {
    const canceled: string[] = name === 'appointment.cancel' ? [result.id] : result.cancelled
    result.mail = await sendCanceled(env, canceled)
    result.waitlist = await freedVisitOffers(env, canceled)
  }
  return result
}

async function inputBody(request: Request): Promise<Record<string, unknown>> {
  const actionName = new URL(request.url).searchParams.get('name') ?? ''
  const moving = actionName.startsWith('movein.'), licensed = actionName === 'codes.cpt.import'
  const limit = moving ? 40_000_000 : licensed ? 22_000_000 : 7_100_000
  // An uploaded file (Move in) arrives as its text, with its name beside it.
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    if (Number(request.headers.get('content-length') ?? 0) > limit) fail('request_too_large', 413)
    const input: Record<string, unknown> = {}
    for (const [key, value] of await request.formData()) {
      if (typeof value === 'string') { input[key] = value; continue }
      if (value.size > (moving || licensed ? 20_000_000 : 1_000_000)) fail(moving || licensed ? 'This file is larger than 20 MB. Use a smaller reviewed export.' : 'The file is larger than 1 MB.', 413)
      if (value.size) {
        if(actionName==='exercise.library.import'&&key==='csv'){input.csv=await value.text()}
        else if(actionName==='exercise.library.import'&&key.startsWith('media_')){
          if(!['image/png','image/jpeg','image/webp'].includes(value.type))fail('use_png_jpeg_or_webp_media')
          const data=new Uint8Array(await value.arrayBuffer());let binary='';for(const byte of data)binary+=String.fromCharCode(byte)
          const map=(input.media??={}) as Record<string,string>;map[value.name]='data:'+value.type+';base64,'+btoa(binary)
        }
        else if(key==='attachment'&&['insurance.payer_eob.attach','insurance.cob.paper.prepare'].includes(new URL(request.url).searchParams.get('name')??'')){Object.assign(input,await uploadField(value))}
        else if (key === 'abnDocument') {
          if (!['application/pdf','image/png','image/jpeg','image/webp'].includes(value.type)) fail('upload_a_pdf_png_jpeg_or_webp_abn')
          const bytes = new Uint8Array(await value.arrayBuffer())
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
          input.abnDocument = `data:${value.type};base64,${btoa(binary)}`
        } else if (key === 'exerciseImage') {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.type)) fail('choose_a_png_jpeg_or_webp_image')
          const bytes = new Uint8Array(await value.arrayBuffer())
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
          input.image = `data:${value.type};base64,${btoa(binary)}`
        } else { input[key] = moving ? await uploadText(value) : await value.text(); input[key + 'Name'] = value.name }
      }
    }
    return input
  }
  const raw = await request.text()
  const rawSize=new TextEncoder().encode(raw).length
  const commandJson=new URL(request.url).pathname==='/api/balm/command'&&request.headers.get('content-type')?.includes('application/json')
  if (rawSize > (commandJson?22_000_000:limit)) fail('request_too_large', 413)
  if (request.headers.get('content-type')?.includes('application/json')) {
    let input; try { input = JSON.parse(raw) } catch { fail('invalid_json') }
    if (!input || Array.isArray(input) || typeof input !== 'object') fail('expected_an_object')
    if(commandJson&&rawSize>7_100_000&&input.name!=='codes.cpt.import')fail('request_too_large',413)
    return input
  }
  if (!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) fail('use_json_or_a_form', 415)
  const fields=new URLSearchParams(raw),input:Record<string,unknown>=Object.fromEntries(fields)
  for(const key of ['practitionerIds','locationIds'])if(fields.has(key))input[key+'_item']=fields.getAll(key+'_item')
  return input
}

const sameOrigin = (request: Request, env: Bindings) => request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site'
const message = (error: unknown) => {
  const status = Number((error as any)?.status) || 500
  return { status, text: status < 500 ? plain(String((error as Error).message)) : 'Could not complete this change. Refresh and try again.' }
}

async function publicResponse(request: Request, env: Bindings, path: string): Promise<Response | null> {
  const url = new URL(request.url)
  const feed = path.match(/^\/calendar\/([A-Za-z0-9_-]{32})\.ics$/)
  if (feed) {
    if (request.method !== 'GET') fail('method_not_allowed', 405)
    return calendarFeed(env.DB, feed[1])
  }
  if(path.startsWith('/book/payment/'))return bookingPaymentResponse(request,env)
  if (path === '/book') {
    if (request.method === 'POST' && request.headers.get('origin') !== env.AUTH_ORIGIN) fail('cross_site_request_refused', 403)
    if (!await takeAddressRate(env, request, 'booking')) return renderPublic('missing', { error: 'Too many requests. Wait up to 15 minutes and try again.' }, 429)
    const params = Object.fromEntries(url.searchParams)
    const clinic = await env.DB.prepare('SELECT clinic_name,time_zone,booking_open,booking_embed_origins FROM bm_settings WHERE id=1').first<any>()
    const rooms=(await env.DB.prepare('SELECT r.id,r.name,l.name AS location,l.time_zone FROM bm_rooms r JOIN bm_room_locations x ON x.room_id=r.id JOIN bm_locations l ON l.id=x.location_id WHERE r.active=1 AND l.active=1 ORDER BY l.name,r.name').all()).results
    const options = { rooms, clinic, embedOrigins: JSON.parse(clinic?.booking_embed_origins ?? '[]'), services: (await env.DB.prepare('SELECT id,name,duration_minutes,price_cents FROM bm_services WHERE active=1 AND self_book_enabled=1 ORDER BY name').all()).results,
      practitioners: (await env.DB.prepare("SELECT id,name,profession FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name").all()).results }
    if (request.method === 'POST') {
      let input: Record<string, unknown> = {}
      try {
        if (request.headers.get('origin') !== env.AUTH_ORIGIN) fail('cross_site_request_refused', 403)
        input = await inputBody(request)
        if (!await takeEmailRate(env, 'booking', typeof input.email === 'string' ? input.email : '')) return renderPublic('missing', { error: 'Too many requests. Wait up to 15 minutes and try again.' }, 429)
        if (input.website) fail('booking_refused', 400) // A filled hidden field is a bot.
        const booked = await bookOnline(env.DB, input, env)
        if(booked.paymentToken)return redirect('/book/payment/'+booked.paymentToken)
        const intake = await bookedIntake(env.DB, booked.clientId, booked.appointmentId, booked.startAt, [booked.appointmentId])
        const mail = intake === 'ask' ? await sendIntake(env, booked.clientId, booked.token, booked.startAt, undefined, [booked.appointmentId], booked.email)
          : await sendBooked(env, booked.clientId, booked.startAt, 1, [booked.appointmentId], booked.email)
        if (intake !== 'ask') return redirect('/book?booked=1&intake=' + intake)
        // Balm on this computer sends no email: the patient keeps this page's address instead.
        return redirect(`/intake/${booked.token}?booked=1&mail=${mail === 'sent' && env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1' ? 'local' : mail}`)
      } catch (error) {
        const failure = message(error), code = (error as any)?.code ?? (error as Error)?.message
        if (failure.status === 429) return renderPublic('missing', { error: failure.text }, 429)
        // The patient's details come back filled in; a taken or missing time offers the open times instead.
        const typed = Object.fromEntries(['firstName', 'lastName', 'dateOfBirth', 'phone', 'email', 'privacy', 'coverageChoice', 'deliveryMethod'].map(key => [key, typeof input[key] === 'string' ? input[key] : '']))
        const chosen = { roomId:String(input.roomId??''), serviceId: String(input.serviceId ?? ''), practitionerId: String(input.practitionerId ?? ''), start: String(input.start ?? '') }
        const retime = code === 'slot_unavailable' || code === 'invalid_start' || !chosen.start
        const from = !clinic?.time_zone || Number.isNaN(Date.parse(chosen.start)) ? undefined : hostDateAt(new Date(chosen.start), clinic!.time_zone)
        const slots = chosen.serviceId && chosen.practitionerId ? await openSlots(env.DB, { ...chosen, from }).catch(() => null) : null
        return renderPublic('book', { ...options, params: chosen, slots, typed, retime, error: failure.text }, failure.status)
      }
    }
    let slots = null, error = ''
    if (params.serviceId && params.practitionerId) {
      try { slots = await openSlots(env.DB, params) } catch (e) { error = message(e).text }
    }
    return renderPublic('book', { ...options, params, slots, error })
  }
  const offer = path.match(/^\/offer\/([A-Za-z0-9_-]{20,64})$/)
  if (offer) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        try {
          const accepted = await acceptOffer(env.DB, offer[1])
          const mail = accepted.intakeToken
            ? await sendIntake(env, accepted.clientId, accepted.intakeToken, accepted.startAt, 'You accepted a time from the waitlist, and your appointment is booked', [accepted.appointmentId])
            : await sendBooked(env, accepted.clientId, accepted.startAt, 1, [accepted.appointmentId])
          await noticeOthers(env, accepted.offerId)
          return redirect(accepted.intakeToken ? `/intake/${accepted.intakeToken}?booked=1&mail=${mail}` : `/offer/${offer[1]}`)
        } catch (error) {
          const view = await offerView(env.DB, offer[1])
          if (view.offer.status !== 'open') await noticeOthers(env, view.offer.offer_id as string)
          const failure = message(error)
          return renderPublic('offer', { ...await offerView(env.DB, offer[1]), error: failure.status === 409 ? '' : failure.text }, failure.status)
        }
      }
      return renderPublic('offer', await offerView(env.DB, offer[1]))
    } catch (error) {
      const failure = message(error)
      return failure.status === 404 ? renderPublic('missing', {}, 404) : renderPublic('missing', { error: failure.text }, failure.status)
    }
  }
  const consent = path.match(/^\/consent\/([A-Za-z0-9_-]{32,64})$/)
  if (consent) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        await signRenewals(env.DB, consent[1], await parseIntakeInput(request), request.headers.get('CF-Connecting-IP') ?? '')
        return redirect(path)
      }
      return renderPublic('consent', await consentView(env.DB, consent[1]))
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      return renderPublic('consent', { ...await consentView(env.DB, consent[1]), error: failure.text }, failure.status)
    }
  }
  const intake = path.match(/^\/intake\/([A-Za-z0-9_-]{20,64})$/)
  if (intake) {
    if (request.method === 'POST' && !sameOrigin(request, env)) fail('cross_site_request_refused', 403)
    if (!await takeAddressRate(env, request, 'intake')) return renderPublic('missing', { error: 'Too many requests. Wait up to 15 minutes and try again.' }, 429)
    const ratePatient = await env.DB.prepare(`SELECT c.id,c.email FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id
      WHERE a.intake_token_hash=? AND a.status='booked' AND a.end_at>? AND c.erased_at IS NULL`).bind(await sha256(intake[1]), new Date().toISOString()).first<{ id: string; email: string | null }>()
    if (ratePatient && !await takePatientRate(env, 'intake', ratePatient)) return renderPublic('missing', { error: 'Too many requests. Wait up to 15 minutes and try again.' }, 429)
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        if (url.searchParams.get('do') === 'card') return redirect(await intakeCardEntry(env, intake[1], Object.fromEntries(new URLSearchParams(await request.text()))))
        await submitIntake(env.DB, intake[1], await parseIntakeInput(request), { ip: request.headers.get('CF-Connecting-IP') ?? '' })
        return redirect(`/intake/${intake[1]}`)
      }
      const view = await intakeView(env.DB, intake[1])
      return renderPublic('intake', { ...view, cardEntry: await cardEntryView(env, view.appointment.client_id, 'intake', url.searchParams.get('setup')), booked: url.searchParams.get('booked') === '1', mail: url.searchParams.get('mail') })
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      const view = await intakeView(env.DB, intake[1])
      return renderPublic('intake', { ...view, cardEntry: await cardEntryView(env, view.appointment.client_id, 'intake'), error: failure.text }, failure.status)
    }
  }
  const messageAttachment = path.match(/^\/messages\/([A-Za-z0-9_-]{43})\/attachments\/([\w-]+)$/)
  if (messageAttachment) {
    if (request.method !== 'GET') fail('method_not_allowed', 405)
    return await linkAttachment(env.DB, messageAttachment[1], messageAttachment[2])
  }
  const privatePage = path.match(/^\/(visit|messages)\/([A-Za-z0-9_-]{20,64})$/)
  if (privatePage) {
    const [, matchedKind, token] = privatePage
    const kind = matchedKind as 'visit' | 'messages'
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        const input = kind === 'messages' ? await parseMessageInput(request) : await inputBody(request)
        if (kind === 'visit' && input.action === 'cancel') {
          const cancelled = await cancelPatientAppointment(env, token, input)
          await patientChangedNotice(env, cancelled.id, 'cancelled')
          return redirect('/portal?cancelled=1')
        }
        if (kind === 'visit' && input.action === 'move') {
          const moved = await movePatientAppointment(env, token, input)
          await sendVisitChange(env, [moved.id], 'moved')
          return redirect('/portal?rescheduled=1')
        }
        if (kind === 'visit') await visitReply(env, token, input)
        else await patientSend(env, token, input)
        return redirect(`/${kind}/${token}?saved=1`)
      }
      const data = kind === 'visit' ? { ...await visitReplyView(env, token), reschedule: await patientVisitSlots(env, token, { from: url.searchParams.get('from') || undefined }) } : await patientMessages(env, token)
      return renderPublic(kind, { ...data, notice: url.searchParams.has('saved') ? 'Your reply is saved for the clinic.' : '' })
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      const data = kind === 'visit' ? { ...await visitReplyView(env, token), reschedule: await patientVisitSlots(env, token, { from: url.searchParams.get('from') || undefined }) } : await patientMessages(env, token)
      return renderPublic(kind, { ...data, error: failure.text }, failure.status)
    }
  }
  if (path.startsWith('/pay/')) return paymentsPublicResponse(request, env, path, sameOrigin(request, env))
  const plan = path.match(/^\/plan\/([A-Za-z0-9_-]{40,64})$/)
  if (plan) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        await certifyPlan(env.DB, plan[1], await inputBody(request))
        return redirect(`/plan/${plan[1]}`)
      }
      return renderPublic('plan', await planView(env.DB, plan[1]))
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      return renderPublic('plan', { ...await planView(env.DB, plan[1]), error: failure.text }, failure.status)
    }
  }
  return null
}

export async function balmResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  const isPortal = path === '/portal' || path.startsWith('/portal/')
  const intakeDocumentPath = path.match(/^\/app\/intake\/(consents|insurance|identity)\/([\w-]+)(\.pdf|\/(front|back)|\/photo)$/)
  const isPublic = isPortal || path.startsWith('/calendar/') || (path === '/book' || path.startsWith('/book/payment/')) || path.startsWith('/consent/') || path.startsWith('/intake/') || path.startsWith('/offer/') || path.startsWith('/pay/') || path.startsWith('/plan/') || path.startsWith('/visit/') || path.startsWith('/messages/')
  if (!isPublic && !intakeDocumentPath && !path.startsWith('/api/balm/') && !pages.test(path) && path !== '/app/action') return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/balm/agent/')
  let who: Actor | undefined
  const back = returnTarget(url.searchParams.get('returnTo') ?? '')
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('wrong_application_origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (isPortal) return portalResponse(request, env)
    if (isPublic) return await publicResponse(request, env, path)
    // The agent door's schema, for assistants that import one; it holds no clinic data.
    if (path === '/api/balm/agent/openapi.json' && request.method === 'GET') return json(agentOpenApi(env.AUTH_ORIGIN))
    const mailEvent = await mailEventResponse(request, env)
    if (mailEvent) return mailEvent
    // Stripe signs its webhook; it carries no session.
    if (path === WEBHOOK_PATH) return await paymentsPublicResponse(request, env, path, false) ?? json({ error: 'Not found' }, 404)
    if (request.method === 'POST' && !isAgent && !sameOrigin(request, env)) fail('cross_site_request_refused', 403)
    who = await principal(request, env, isAgent)
    if(isAgent){
      const scopeRead=path.match(/^\/api\/balm\/agent\/(appointments|patients|charges|payments)$/)
      if(scopeRead&&request.method==='GET')return json(await scopedRead(env.DB,who,scopeRead[1],Object.fromEntries(url.searchParams)))
      if(path==='/api/balm/agent/context'&&request.method==='GET')requireScope(who,'context.read')
      else if(path!=='/api/balm/agent/command')fail('key_scope_refused',403)
    }
    if (request.method === 'GET') {
      roleRead(who,path)
      if(path==='/api/balm/exercises')return json(await exerciseLibrary(env.DB,who,Object.fromEntries(url.searchParams)))
      const recordPath=path.match(/^\/api\/balm\/records\/([\w-]+)\.(pdf|json)$/)
      if(recordPath)return await recordDownload(env.DB,recordPath[1],recordPath[2]==='pdf'?'pdf':'fhir',who)
      if (manager(who) && path === '/api/balm/reports/location') return json((await locationState(env.DB,who,Object.fromEntries(url.searchParams))).location)
      const letterPreview=path.match(/^\/api\/balm\/letters\/([\w-]+)\.pdf$/)
      if(letterPreview && request.method==='GET') return await previewLetter(env.DB,who,letterPreview[1])
      const chartDocument = path.match(/^\/api\/balm\/chart-documents\/([\w-]+)$/)
      if (chartDocument) return await downloadDocument(env.DB, who, chartDocument[1])
      const chartSearch = path.match(/^\/api\/balm\/clients\/([\w-]+)\/history$/)
      if (chartSearch) {
        clinicalActor(who)
        const file = await fileFor(env, who, chartSearch[1], undefined, Object.fromEntries(url.searchParams))
        return json(file.chartHistory)
      }
      const inboxPath = path.match(/^\/api\/balm\/clients\/([\w-]+)\/inbox$/)
      if (inboxPath) { human(who); return json(await inboxFor(env.DB,who,inboxPath[1])) }
      const communicationSearch = path.match(/^\/api\/balm\/clients\/([\w-]+)\/communications$/)
      if (communicationSearch) return json(await communicationHistory(env.DB, who, communicationSearch[1], Object.fromEntries(url.searchParams)))
      const messageAttachment = path.match(/^\/api\/balm\/messages\/attachments\/([\w-]+)$/)
      if (messageAttachment) return await clinicAttachment(env.DB, who, messageAttachment[1])
      if (intakeDocumentPath) {
        const [, kind, id, suffix, side] = intakeDocumentPath
        if ((kind === 'consents' && suffix !== '.pdf') || (kind === 'insurance' && !side) || (kind === 'identity' && suffix !== '/photo')) fail('not_found', 404)
        const doc = kind === 'consents' ? await consentDocument(env.DB, who, id) : kind === 'identity' ? await identityPhoto(env.DB, who, id) : await insurancePhoto(env.DB, who, id, side)
        return new Response(doc.bytes, { headers: { ...headers, 'content-type': doc.mime, 'content-disposition': `${kind === 'consents' ? 'attachment' : 'inline'}; filename="${doc.filename}"`, 'content-security-policy': "default-src 'none'" } })
      }
      if (pages.test(path)) return await page(env, who, path === '/app' && url.search ? returnTarget(path + url.search) : ['/app/reports','/app/insurance'].includes(path) ? path + url.search : path, path.startsWith('/app/clients/') ? { ask: Object.fromEntries(url.searchParams) } : path === '/app/clinic' && url.searchParams.has('invited') ? { invited: url.searchParams.get('invited') } : {})
      if (path === '/api/balm/access-refusals' || path === '/api/balm/access-refusals.csv') {
        human(who);insist(who.role==='owner','only_the_owner_reads_access_refusals',403)
        const found=(await env.DB.prepare("SELECT sequence,at,actor_email,actor_role,action,detail FROM bm_audit WHERE action='access.refused' ORDER BY sequence DESC LIMIT 500").all()).results
        await commit(env.DB,who,[audit(env.DB,who,'access.refusals_read',null)])
        if(path.endsWith('.csv')){const columns=['at','actor_email','actor_role','action','detail'];const cell=csvCell;return new Response([columns.map(cell).join(','),...found.map(row=>columns.map(k=>cell(row[k])).join(','))].join('\r\n')+'\r\n',{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="balm-access-refusals.csv"'}})}
        return json(found)
      }
      if (path === '/api/balm/readiness.json') { const result=await readinessState(env,who); await commit(env.DB,who,[audit(env.DB,who,'readiness.exported',null)]); return new Response(JSON.stringify(result,null,2),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename=balm-readiness.json'}}) }
      if (path === '/api/balm/state' || path === '/api/balm/agent/context') return json(await state(env, who))
      if (path === '/api/balm/cases') return json(await caseList(env, who))
      if (path === '/api/balm/commands') return json({ preparations, approvals, rule: 'Agent keys prepare; a signed-in person approves. Approvals keep the digest of the exact approved bytes.' })
      if (path === '/api/balm/reports') return json(await operationalReports(env.DB, who, Object.fromEntries(url.searchParams)))
      if (path === '/api/balm/reports/financial') return json(await financialReports(env.DB, who, Object.fromEntries(url.searchParams)))
      if (path === '/api/balm/reports/outcomes' || path === '/api/balm/reports/outcomes.csv') {
        const report = await outcomeReport(env.DB,who,Object.fromEntries(url.searchParams))
        if (!path.endsWith('.csv')) return json(report)
        return new Response(outcomeCsv(report),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="balm-outcomes.csv"','content-security-policy':"default-src 'none'"}})
      }
      const financial = path.match(/^\/api\/balm\/reports\/financial\/([a-z-]+)\.csv$/)
      if (financial && (financialKinds as readonly string[]).includes(financial[1])) {
        const report = await financialReports(env.DB, who, Object.fromEntries(url.searchParams))
        return new Response(financialCsv(report, financial[1] as FinancialKind), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="balm-${financial[1]}-${report.from}-${report.to}.csv"`, 'content-security-policy': "default-src 'none'" } })
      }
      const operational = path.match(/^\/api\/balm\/reports\/([a-z]+)\.csv$/)
      if (operational && (reportKinds as readonly string[]).includes(operational[1])) {
        const report = await operationalReports(env.DB, who, Object.fromEntries(url.searchParams))
        return new Response(operationalCsv(report, operational[1] as ReportKind), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="balm-${operational[1]}-${report.from}-${report.to}.csv"`, 'content-security-policy': "default-src 'none'" } })
      }
      const reportPath = path.match(/^\/api\/balm\/clients\/([\w-]+)\/(disclosures|access-report)$/)
      if (reportPath) {
        const input = Object.fromEntries(url.searchParams), kind = reportPath[2] === 'disclosures' ? 'disclosures' : 'access'
        const report = await (kind === 'disclosures' ? disclosureReport : accessReport)(env.DB, who, reportPath[1], input)
        if (url.searchParams.get('format') === 'csv') return new Response(reportCsv(report, kind), { headers: { ...headers,
          'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="balm-${kind}-${report.from}-${report.to}.csv"`,
          'content-security-policy': "default-src 'none'",
        } })
        return json(report)
      }
      const file = path.match(/^\/api\/balm\/clients\/([\w-]+)$/)
      if (file) return json(await fileFor(env, who, file[1], url.searchParams.get('auditBefore') ?? undefined, Object.fromEntries(url.searchParams)))
      const sheet = path.match(/^\/api\/balm\/day-sheet\.(html|csv)$/)
      if (sheet) {
        // SCHED-002: print or export one day of the calendar the actor may see.
        need(who, 'owner', 'reception', 'practitioner'); human(who)
        const view = await calendarView(env.DB, who, { ...Object.fromEntries(url.searchParams), view: 'day' })
        if (sheet[1] === 'csv') return new Response(daySheetCsv(view), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="balm-day-sheet-${view.date}.csv"`, 'content-security-policy': "default-src 'none'" } })
        const clinic = (await one(env.DB, 'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name as string
        return new Response(daySheetHtml(view, clinic), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })
      }
      const invoice = path.match(/^\/api\/balm\/invoices\/([\w-]+)\.html$/)
      if (invoice) {
        const download = await invoiceDownload(env.DB, who, invoice[1])
        return new Response(download.bytes, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${download.name}"`, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })
      }
      const paper=path.match(/^\/api\/balm\/insurance\/(paper|paper-eob)\/([\w-]+)$/)
      if(paper)return await cobPaperDownload(env.DB,who,paper[2],paper[1]==='paper-eob')
      const eob=path.match(/^\/api\/balm\/insurance\/eob\/([\w-]+)$/)
      if(eob)return await payerEobDownload(env.DB,who,eob[1])
      const x12 = path.match(/^\/api\/balm\/insurance\/(270|837P|abn|authorization-request)\/([\w-]+)$/)
      if (x12) {
        const download = await insuranceDownload(env, who, x12[1], x12[2])
        return new Response(download.body, { headers: { ...headers, 'content-type': download.contentType, 'content-disposition': `attachment; filename="${download.filename}"` } })
      }
      const release=path.match(/^\/api\/balm\/note-releases\/([\w-]+)\.pdf$/)
      if(release)return new Response(await releasePdf(env.DB,who,release[1]),{headers:{...headers,'content-type':'application/pdf','content-disposition':'attachment; filename="payer-note-release.pdf"'}})
      const aeob=path.match(/^\/api\/balm\/aeobs\/([\w-]+)\.pdf$/)
      if(aeob){human(who);insist(who.role==='owner','only_the_owner_reviews_payer_estimates',403);const row=await one(env.DB,'SELECT client_id FROM bm_aeob_sources WHERE id=?',aeob[1]);insist(row,'payer_estimate_not_found',404);const doc=await aeobOriginal(env.DB,row.client_id,aeob[1]);await commit(env.DB,who,[audit(env.DB,who,'aeob.original_reviewed',row.client_id,aeob[1])]);return new Response(doc.bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${doc.name}"`}})}
      const estimate = path.match(/^\/api\/balm\/estimates\/([\w-]+)\.pdf$/)
      if(estimate){need(who,'owner','reception');human(who);const row=await one(env.DB,'SELECT client_id FROM bm_estimates WHERE id=?',estimate[1]);insist(row,'estimate_not_found',404);const doc=await estimateOriginal(env.DB,row.client_id as string,estimate[1]);await commit(env.DB,who,[audit(env.DB,who,'estimate.downloaded',row.client_id as string,estimate[1])]);return new Response(doc.bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${doc.name}"`}})}
      const document = await paymentDocument(env.DB, who, path, url.searchParams)
      if (document) return document
      const original = path.match(/^\/api\/balm\/imports\/([\w-]+)\/original\.csv$/)
      if (original) {
        if (who.role !== 'owner') fail('only_the_owner_imports', 403)
        const file = await importOriginal(env.DB, who, original[1])
        return new Response(file.bytes, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cliniko-import-${original[1].slice(0, 12)}.csv"` } })
      }
      const reminder = path.match(/^\/api\/balm\/reminders\/([\w-]+)\.txt$/)
      if (reminder) return new Response(await reminderDownload(env.DB, who, reminder[1]), { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="balm-reminder-${reminder[1]}.txt"` } })
    } else {
      if (path === '/app/action') {
        const name = url.searchParams.get('name') ?? ''; let input = (name.startsWith('message.') || name === 'chart.document.upload' || name === 'estimate.aeob.prepare') ? await parseMessageInput(request) : await inputBody(request)
        if (name === 'session.signout') {
          const response = await operatorAuth(env).signOut(request)
          return new Response(null, { status: 303, headers: { ...headers, 'set-cookie': response.cookie, location: '/signin' } })
        }
        for (const key of ['amountCents', 'durationMinutes', 'priceCents', 'version', 'revision', 'noteId']) if (input[key] === '') delete input[key]
        // People type money in dollars on every page; commands keep integer cents.
        if (typeof input.price === 'string') input.priceCents = parseDollars(input.price, 'price')
        if (typeof input.amount === 'string' && input.amount.trim()) input.amountCents = parseDollars(input.amount)
        delete input.price; delete input.amount
        if(name==='service.save'){for(const key of ['practitionerIds','locationIds'])if(input[key]!==undefined)input[key]=input[key+'_item']??[]}
        if(name==='schedule.exception'&&input.mode==='open')input.windows=[{start:input.start,end:input.end}]
        if (['hours.save','location.save'].includes(name) && input.hoursForm === 'on') input.hours = hoursFromForm(input)
        if (name === 'intake.prepare' && 'questionCount' in input) {
          // Builder edits (move, remove, add) only redraw the form; preparing saves the draft.
          const rows = builderRows(input), builder = { title: String(input.title ?? ''), rows }
          if (typeof input.edit === 'string' && input.edit) return await page(env, who, '/app/intake', { builder: { ...builder, rows: editRows(rows, input.edit) } })
          try { input.questions = questionsFromRows(rows) } catch (error) { return await page(env, who, '/app/intake', { error: message(error).text, builder }, 400) }
        }
        if (name === 'import.preview' && typeof input.file === 'string') input.csv = input.file
        if ((name === 'import.preview' || name === 'import.apply') && typeof input.csvBase64 === 'string') input.csv = fileFromField(input.csvBase64)
        if (name.startsWith('movein.')) input = bundleFormInput(input)
        let result: unknown
        try { result = await execute(request, env, who, name, input) } catch (error) {
          const failure = message(error)
          if (!['movein.apply', 'movein.cutover'].includes(name) || failure.status >= 500) throw error
          const preview = await bundleCommand(env.DB, who, 'movein.preview', input)
          return await page(env, who, back, { error: failure.text, result: { ...preview, reviewInput: input } }, failure.status)
        }
        if (name === 'accounting.prepare') return await page(env, who, back, { message: (result as any).status === 'up_to_date' ? 'QuickBooks matches this day. No new journal is needed.' : 'Review the saved journal below, then approve the exact handoff.' })
        if (name === 'accounting.sync') return await page(env, who, back, { message: 'The saved journal matches QuickBooks. Repeating it creates no new entry.' })
        if (name.startsWith('letter.')) return redirect(back+'#clinical-letters')
        if (name === 'chart.document.upload') return redirect('/app/clients/' + encodeURIComponent(String((result as any).clientId)) + '#chart-history')
        if (name === 'consent.request') return await page(env, who, back, { message: (result as any).mail === 'sent' ? 'Documents emailed. The private link expires in seven days.' : 'Email could not be sent. Check the patient’s email and the clinic’s mail settings.' })
        // A refresh must read the result, never repeat the change. Results shown
        // once (an import review or journal, a new key, a booking's intake link) render directly.
        if (!['insurance.eligibility.cohort.preview', 'retention.preview', 'retention.retail.preview', 'movein.preview', 'movein.prepare', 'movein.cutover', 'movein.journal', 'movein.apply', 'movein.undo', 'import.preview', 'import.journal', 'agent.create', 'integration.hook.create', 'calendar.feed.create', 'appointment.book', 'series.preview', 'series.book', 'pay.link.create', 'message.link', 'message.send', 'plan.send', 'plan.resend', 'consent.request', 'scribe.check', 'insurance.batch.submit', 'insurance.eligibility.submit', 'insurance.denial.appeal', 'codes.update', 'codes.update.continue', 'codes.cpt.import', 'codes.search', 'codes.synonym.save'].includes(name)) {
          // An invitation says who it went to, and how, once the page reloads.
          if (name === 'staff.invite') return redirect(`/app/clinic?invited=${encodeURIComponent(String(input.id ?? ''))}`)
          const offered = (result as any)?.waitlist?.people
          return redirect(offered && back.startsWith('/app?') ? `${back}&offered=${offered}` : offered && back === '/app' ? `/app?offered=${offered}` : back)
        }
        if (name === 'movein.preview' || name === 'movein.prepare') return await page(env, who, back, { result: { ...(result as object), reviewInput: input } })
        return await page(env, who, back, { ...(['series.preview', 'import.preview', 'import.journal'].includes(name) ? {} : { message: 'Saved.' }), result: name === 'import.preview' ? { ...(result as object), csv: input.csv } : result })
      }
      if (path === '/api/balm/command' || path === '/api/balm/agent/command') {
        const body = await inputBody(request)
        if (typeof body.name !== 'string' || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) fail('provide_a_command_name_and_input_object')
        if (isAgent && !preparations.includes(String(body.name))) fail('agents_can_only_prepare', 403)
        if(isAgent)requireScope(who,body.name==='movein.prepare'?'migration.prepare':String(body.name))
        return json({ result: await execute(request, env, who, String(body.name), body.input as Record<string, unknown>) })
      }
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    const failure = message(error)
    if (who && [403,404].includes(failure.status)) await commit(env.DB,who,[audit(env.DB,who,'access.refused',null,null,request.method + ' ' + path + (path === '/app/action' ? ' ' + (url.searchParams.get('name') ?? '') : ''))]).catch(()=>{})
    if (failure.status >= 500) console.error(error)
    const detail = (error as any)?.detail
    if (who && failure.status === 403 && (biller(who) || manager(who) || ['assistant','student','fellow'].includes(who.staffKind ?? ''))) return renderPublic('refused',{reason:failure.text},403)
    if (path === '/app/action' && who && manager(who)) return renderPublic('refused',{reason:failure.text},failure.status)
    if (path === '/app/action' && who && failure.status !== 401) return page(env, who, back, { error: failure.text, ...(detail ? { result: detail } : {}) }, failure.status)
    if ((pages.test(path) || path === '/app/action') && failure.status === 401) return redirect('/signin?returnTo=' + encodeURIComponent(pages.test(path) ? path : back))
    if (pages.test(path) && who) return page(env, who, '/app', { error: failure.text }, failure.status)
    // Refused before any page could load (staff set inactive): a page to read, not JSON.
    if ((pages.test(path) || path === '/app/action') && failure.status === 403) return renderPublic('refused', { reason: failure.text }, 403)
    return json({ error: failure.text, code: (error as any)?.code ?? (error as Error)?.message, ...(detail ? { detail } : {}) }, failure.status)
  }
}
