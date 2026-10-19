import { check, desk, dollarsField, field, form, h, hidden, money, owner, panel, stamp } from './shared'

export function visitPolicyPanel(s: any) {
  if (!owner(s)) return ''
  return panel('Cancellation and no-show policy', form('visit_policy.save', '/app/clinic',
    field('noticeHours', 'Cancellation notice (hours)', s.settings.cancellation_notice_hours, 'number', 'required min="0" max="8760"')
    + field('lateCancelFee', 'Late cancellation fee ($; 0 for none)', dollarsField(s.settings.late_cancel_fee_cents), 'number', 'required min="0" step="0.01"')
    + field('noShowFee', 'No-show fee ($; 0 for none)', dollarsField(s.settings.no_show_fee_cents), 'number', 'required min="0" step="0.01"')
    + '<p class="help">Cancellation requires a reason. Inside this notice window, Balm proposes the late cancellation fee. A no-show proposes its fee. A person must review and confirm each charge to an authorized card on file.</p>', 'Save visit policy'), '', 'visit-policy')
}
export function visitFeePanel(s: any, a: any, back: string) {
  const fee = s.visitFees?.find((f: any) => f.appointment_id === a.id)
  const cancellation = a.cancellation
  const why = cancellation ? `<p>Canceled by ${h(cancellation.actor_email)} (${h(cancellation.actor_role)}) · ${stamp(s, cancellation.cancelled_at)}<br>Reason: ${h(cancellation.reason)}</p>` : ''
  if (!fee) return why
  const title = fee.kind === 'no_show' ? 'No-show fee' : 'Late cancellation fee'
  const result = fee.payment_id ? `<p>${h(title)} ${money(fee.amount_cents)} · ${h(fee.payment_status ?? 'pending payment outcome')}${fee.confirmed_by ? ` · confirmed by ${h(fee.confirmed_by)}` : ''}</p>${fee.failure ? `<p class="help">${h(fee.failure)}</p>` : ''}`
    : `<p>${h(title)} proposed: <strong>${money(fee.amount_cents)}</strong>. Nothing has been charged.</p>${desk(s) ? form('appointment.fee.confirm', back, hidden('id', fee.id) + check('authorization', 'The patient authorized this specific fee to their saved card.') + field('authorizationRecord', 'Patient authorization record (date and evidence)', '', 'text', 'required maxlength="1000"') + check('confirm', `I approve the ${money(fee.amount_cents)} ${title.toLowerCase()} and confirm charging the patient's authorized card on file.`), `Confirm and charge ${money(fee.amount_cents)}`) : '<p class="help">Reception or the owner must approve and confirm this charge.</p>'}`
  return why + `<div class="entry">${result}</div>`
}
