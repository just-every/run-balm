import { retentionPanel, retentionPreview } from './retention'
import { visitPolicyPanel } from './visit-policy'
import { paymentReviewPanel } from './payment-plans'
import { followupSettingsPanel } from './followups'
import { holidaysPanel } from './holidays'
import { clinicIdentityFields } from './clinic-identity'
import { documentationSettingsPanel } from './documentation'
import { template } from '../charting/templates'
import { templateSelect } from './notes'
import { scribeCard } from './scribe'
import { clinicPayments } from './payments'
import { reminderSettingsPanel } from './reminders'
import { hoursFor } from './hours'
import { timeZoneField } from './time-zone'
import { fullName } from '../domain/model'
import { dollarsField, empty, entry, field, form, h, hidden, money, panel, rows, select, status } from './shared'

const staffFields = (p?: any) => field('name', 'Full name', p?.name, 'text', 'required maxlength="160"') + field('email', 'Email', p?.email, 'email', 'required')
  + select('role', 'Role', [['practitioner', 'Practitioner'], ['reception', 'Reception']], p?.role ?? 'practitioner')
  + `<div class="pair">${field('profession', 'Profession (for invoices)', p?.profession ?? '', 'text', 'maxlength="80" placeholder="Physical Therapist"')}${field('providerNumber', 'Provider number (for invoices)', p?.provider_number ?? '', 'text', 'maxlength="40"')}</div>`
  + field('credentials', 'Credentials (for signatures)', p?.credentials ?? '', 'text', 'maxlength="60" placeholder="PT, DPT · OTR/L · CCC-SLP"')
  + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], p ? String(!!p.active) : 'true')

/** The owner's own name and, if they treat clients, their place on the staff list. */
function you(s: any) {
  const me = s.me
  if (!me) return ''
  const named = fullName(me.name), onStaff = rows(s, 'staff').some(p => p.email.toLowerCase() === me.email.toLowerCase())
  const nameForm = form('owner.name', '/app/clinic', field('name', 'Your first and last name', named ? me.name : '', 'text', 'required maxlength="120" autocomplete="name" placeholder="Jordan Lee"'), 'Save your name')
  return `<section class="panel full" id="you"><h2>You</h2>${named ? `<p>Signed in as <strong>${h(me.name)}</strong> (${h(me.email)}).</p><details><summary>Change your name</summary>${nameForm}</details>`
    : `<p class="notice" role="note">Balm knows you as “${h(me.name || 'Owner')}”. Enter your first and last name: it goes on your signed notes and on insurance claims for clients you treat.</p>${nameForm}`}`
    + (named && !onStaff ? `<p class="help">If you treat clients too, add yourself to the staff list as a practitioner.</p>${form('staff.save', '/app/clinic', hidden('name', me.name) + hidden('email', me.email) + hidden('role', 'practitioner'), 'Add me as a practitioner', true)}` : '') + '</section>'
}

export function clinic(s: any, notice: any = {}) {
  const st = s.settings
  const settings = panel('Clinic details', form('settings.save', '/app/clinic', field('clinicName', 'Clinic name', st.clinic_name, 'text', 'required maxlength="120"') + timeZoneField(st) + clinicIdentityFields(st) + select('bookingOpen', 'Online booking', [['true', 'Open'], ['false', 'Closed']], String(!!st.booking_open)), 'Save clinic details'))
  const serviceList = rows(s, 'services').map(x => entry(x.name, `<p>${x.duration_minutes} min · ${money(x.price_cents)} ${x.active ? '' : status('Inactive')}<br><span class="help">Notes start from: ${h(template(x.note_template)?.title ?? 'free text')}</span></p><details><summary>Edit service</summary>${form('service.save', '/app/clinic', hidden('id', x.id) + serviceFields(x), 'Save service')}</details>`)).join('')
  const staff = rows(s, 'staff').map(p => entry(p.name, `<p>${status(p.active ? 'Active' : 'Inactive')} ${status(p.role)}<br>${h(p.email)}${p.profession ? `<br>${h(p.profession)}` : ''}${p.provider_number ? ` · provider ${h(p.provider_number)}` : ''}${p.credentials ? ` · signs as ${h(p.credentials)}` : ''}</p>${p.role === 'practitioner' ? hoursFor(s, p) : ''}`
    + `<details><summary>Edit staff member</summary>${form('staff.save', '/app/clinic', hidden('id', p.id) + hidden('version', p.version) + staffFields(p), 'Save staff member')}</details>`
    + (p.active && p.email.toLowerCase() !== s.actor.email.toLowerCase() ? form('staff.invite', '/app/clinic', hidden('id', p.id), 'Invite to sign in', true) + localSignIn(s, p) : '')
    + `<details><summary>Erase staff member</summary><p>Only staff never invited and never used in clinic work can be erased. Deactivate anyone else to remove their access at once.</p>${form('staff.erase', '/app/clinic', hidden('id', p.id) + '<label class="check"><input type="checkbox" required><span>I understand this erases their personal details.</span></label>', 'Erase staff member', true)}</details>`, `staff-${p.id}`)).join('')
  const roomList = rows(s, 'rooms').map(r => entry(r.name, `<p>${r.active ? '' : status('Inactive')}</p><details><summary>Edit room</summary>${form('room.save', '/app/clinic', hidden('id', r.id) + roomFields(r), 'Save room')}</details>`)).join('')
  const rooms = panel('Rooms', '<p class="help">Optional. A room holds one visit at a time, and the schedule can show each room’s day.</p>' + (roomList || empty('No rooms yet.')) + `<details><summary>Add a room</summary>${form('room.save', '/app/clinic', roomFields(), 'Add room')}</details>`)
  const invited = notice.invited ? rows(s, 'staff').find(p => p.id === notice.invited) : null
  const sent = invited ? `<div class="notice" role="status"><strong>Invitation sent to ${h(invited.name)}.</strong> ${s.local
    ? `Balm is running on this computer, so no email leaves it. To work as ${h(invited.name)}, run <code>rer dev --as ${h(invited.email)}</code> in the Balm folder and open the RER_OPEN link it prints.`
    : `Balm emailed a sign-in link to ${h(invited.email)}. They select it to join; it works once. Select <strong>Invite to sign in</strong> again to send a new link.`}</div>` : ''
  return `<h1>Clinic</h1>${sent}<p>Your clinic details, services, rooms, staff and practitioner hours. Add yourself as a practitioner with your own sign-in email if you treat clients.</p><div class="grid">${retentionPreview(s, notice)}${retentionPanel(s)}${you(s)}${settings}${holidaysPanel(s)}${visitPolicyPanel(s)}${documentationSettingsPanel(s)}${reminderSettingsPanel(s)}${followupSettingsPanel(s)}${clinicPayments(s)}${paymentReviewPanel(s)}${panel('Services', (serviceList || empty('No services yet.')) + `<details${serviceList ? '' : ' open'}><summary>Add a service</summary>${form('service.save', '/app/clinic', serviceFields(), 'Add service')}</details>`)}${rooms}${panel('Staff', (staff || empty('No staff yet.')) + `<details${staff ? '' : ' open'}><summary>Add a staff member</summary>${form('staff.save', '/app/clinic', staffFields(), 'Add staff member')}</details>`, 'full')}${scribeCard(s, notice)}</div>`
}

function serviceFields(x?: any) {
  return field('name', 'Service name', x?.name, 'text', 'required maxlength="120" placeholder="Initial evaluation"') + `<div class="pair">${field('durationMinutes', 'Length (minutes)', x?.duration_minutes ?? 60, 'number', 'required min="5" max="480" step="5"')}${field('price', 'Price ($)', x ? dollarsField(x.price_cents) : '', 'text', 'required inputmode="decimal" maxlength="12" placeholder="95.00"')}</div>` + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], x ? String(!!x.active) : 'true')
    + templateSelect('noteTemplate', 'Notes for this service start from', x?.note_template ?? '')
}

const roomFields = (r?: any) => field('name', 'Room name', r?.name, 'text', 'required maxlength="80" placeholder="Treatment room 1"') + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], r ? String(!!r.active) : 'true')

/** On this computer an emailed link opens only in a browser that already opened Balm, so say how to sign in as this person instead. */
const localSignIn = (s: any, p: any) => !s.local ? '' : p.can_sign_in
  ? `<p class="help">Balm is running on this computer, so no email leaves it. To work as ${h(p.name)} in another browser, run <code>rer dev --as ${h(p.email)}</code> in the Balm folder and open the RER_OPEN link it prints.</p>`
  : `<p class="help">Balm is running on this computer, so no email leaves it. To work as ${h(p.name)}, first select <strong>Invite to sign in</strong>; then run <code>rer dev --as ${h(p.email)}</code> in the Balm folder and open the RER_OPEN link it prints, in another browser.</p>`
