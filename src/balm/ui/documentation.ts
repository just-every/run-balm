import { documentationElements } from '../charting/compliance'
import { dollarsField, field, form, h, hidden, panel, select, stamp } from './shared'

export function documentationFields(value: any = {}, staff: any[] = []) {
 return `<fieldset><legend>Treatment and supervision</legend><div class="pair">${field('totalTreatmentMinutes','Total treatment minutes',value.totalTreatmentMinutes ?? '', 'number','min="0" max="1440"')}${field('totalTimedMinutes','Total timed minutes',value.totalTimedMinutes ?? '', 'number','min="0" max="1440"')}</div><label class="check"><input type="checkbox" name="assistantInvolved"${value.assistantInvolved ? ' checked' : ''}><span>An assistant provided treatment</span></label>${select('supervisorId','Supervising practitioner',[['','No supervisor selected'],...staff.filter(p=>p.role==='practitioner'&&(p.active===undefined||p.active)).map(p=>[p.id,p.name])] as [string,string][],value.supervisorId??'','')}</fieldset>`
}
export const documentationWarnings = (alerts: any[]) => alerts.length ? `<div class="notice" role="note"><strong>Documentation to review</strong><ul>${alerts.map(a=>`<li>${h(a.message)}</li>`).join('')}</ul></div>` : ''
export function documentationSettingsPanel(s:any) {
 const d=s.documentation
 if(!d)return ''
 return panel('Documentation requirements',form('documentation.settings.save','/app/clinic',field('lateDays','Plan certification deadline (days)',d.settings.late_days,'number','required min="1" max="90"')+field('unsignedNoteHours','Unsigned note deadline (hours)',d.settings.unsigned_note_hours,'number','required min="1" max="720"')+field('kxNear','Warn within ($) of the KX threshold',dollarsField(d.settings.kx_near_cents),'text','required inputmode="decimal" maxlength="12"'),'Save documentation warnings')
 +d.payers.map((p:any)=>`<details><summary>${h(p.name)}: required note elements</summary>${form('documentation.payer.save','/app/clinic',hidden('payerId',p.id)+Object.entries(documentationElements).map(([key,label])=>`<label class="check"><input type="checkbox" name="require_${h(key)}"${JSON.parse(p.required).includes(key)?' checked':''}><span>${h(label)}</span></label>`).join(''),'Save payer requirements')}</details>`).join(''))
}
export function documentationDailyClose(s:any) {
 const items=s.documentationClose??[]
 if(!items.length)return ''
 return panel('Daily close: documentation',`<p>Clinical warnings from attended visits and every overdue unsigned note. Open the file to review the note, plan, payer requirements and billing.</p><ul class="plain">${items.map((i:any)=>`<li><a href="/app/clients/${h(i.client_id)}${i.noteId ? '#note-'+h(i.noteId) : ''}">${h(i.client)}${i.noteId ? ' · unsigned note' : ''}</a> · ${h(i.practitioner)} · ${stamp(s,i.start_at)}${i.dueAt ? `<br>Signature due ${stamp(s,i.dueAt)}` : ''}${documentationWarnings(i.alerts)}</li>`).join('')}</ul>`,'full')
}

export function documentationSummary(value: any = {}, staff: any[] = []) {
 const lines = []
 if (value.totalTreatmentMinutes !== null && value.totalTreatmentMinutes !== undefined) lines.push(`Total treatment: ${h(value.totalTreatmentMinutes)} minutes`)
 if (value.totalTimedMinutes !== null && value.totalTimedMinutes !== undefined) lines.push(`Total timed: ${h(value.totalTimedMinutes)} minutes`)
 if (value.assistantInvolved) lines.push(`Assistant treatment · supervisor: ${h(staff.find(p=>p.id===value.supervisorId)?.name ?? 'not recorded')}`)
 return lines.length ? `<p>${lines.join('<br>')}</p>` : ''
}
