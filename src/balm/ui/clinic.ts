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
import { dollarsField, empty, entry, field, form, h, hidden, money, panel, rows, select, status, textarea } from './shared'

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
  const nppes = s.actor?.role === 'owner' ? panel('Referring provider lookup', `<p>When this is on, staff can look up a referring provider’s NPI in the NPPES NPI Registry (npiregistry.cms.hhs.gov). Only the NPI typed is sent; nothing about the patient leaves Balm. When it is off, NPIs are recorded by hand and labelled not checked.</p><p>${st.nppes_lookup ? 'The lookup is on.' : 'The lookup is off.'}</p>`
    + form('referral.nppes_setting', '/app/clinic', hidden('enabled', st.nppes_lookup ? 'false' : 'true'), st.nppes_lookup ? 'Turn the NPPES lookup off' : 'Turn the NPPES lookup on', !!st.nppes_lookup)) : ''
  const team = (s.staff ?? []).filter((p: any) => p.role === 'practitioner' && p.capacity !== undefined)
  const capacityPanel = s.actor?.role === 'owner' ? panel('Concurrent patients', '<p>How many patients a practitioner may see at the same time. A visit is allowed only while the practitioner’s number and the number of every overlapping visit’s service both allow it; both start at 1, which refuses any overlap. Online booking offers only free times unless a service allows online double-booking.</p>'
    + team.map((p: any) => form('capacity.save', '/app/clinic', hidden('practitionerId', p.id) + field('capacity', `${p.name}: patients at once`, p.capacity, 'number', 'required min="1" max="10"'), 'Save', true)).join('')
    + rows(s, 'services').map((x: any) => form('capacity.save', '/app/clinic', hidden('serviceId', x.id) + field('capacity', `${x.name}: patients at once`, x.capacity, 'number', 'required min="1" max="10"')
      + `<label class="check"><input type="checkbox" name="onlineDoubleBooking" value="on"${x.online_double_booking ? ' checked' : ''}><span>Let patients book this service online at times with a place left</span></label>`, 'Save', true)).join(''), 'full', 'capacity') : ''
  const embed = panel('Booking on your website', '<p>Allow these websites to embed your public booking page. Leave the list empty to keep embedding off. Patient portal and private links cannot be embedded.</p>'
    + form('booking.embed.save', '/app/clinic', hidden('version', st.version) + textarea('origins', 'Allowed website origins (one per line)', JSON.parse(st.booking_embed_origins).join('\n'), 'rows="4" maxlength="40960" placeholder="https://www.yourclinic.com"')
      + `<p class="help">Enter up to 20 HTTPS origins with no path, query, fragment or sign-in details.${s.local ? ' On this computer, HTTP localhost and 127.0.0.1 origins are also allowed for development.' : ''}</p>`, 'Save allowed websites'))
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
  return `<h1>Clinic</h1>${sent}<p>Your clinic details, services, rooms, staff and practitioner hours. Add yourself as a practitioner with your own sign-in email if you treat clients.</p><div class="grid">${retentionPreview(s, notice)}${retentionPanel(s)}${you(s)}${settings}${nppes}${capacityPanel}${embed}${holidaysPanel(s)}${visitPolicyPanel(s)}${documentationSettingsPanel(s)}${reminderSettingsPanel(s)}${followupSettingsPanel(s)}${clinicPayments(s)}${paymentReviewPanel(s)}${panel('Services', (serviceList || empty('No services yet.')) + `<details${serviceList ? '' : ' open'}><summary>Add a service</summary>${form('service.save', '/app/clinic', serviceFields(), 'Add service')}</details>`)}${rooms}${panel('Staff', (staff || empty('No staff yet.')) + `<details${staff ? '' : ' open'}><summary>Add a staff member</summary>${form('staff.save', '/app/clinic', staffFields(), 'Add staff member')}</details>`, 'full')}${scribeCard(s, notice)}</div>`
}

function serviceFields(x?: any) {
  return (x ? hidden('version', x.version) : '') + field('name', 'Service name', x?.name, 'text', 'required maxlength="120" placeholder="Initial evaluation"') + `<div class="pair">${field('durationMinutes', 'Length (minutes)', x?.duration_minutes ?? 60, 'number', 'required min="5" max="480" step="5"')}${field('price', 'Price ($)', x ? dollarsField(x.price_cents) : '', 'text', 'required inputmode="decimal" maxlength="12" placeholder="95.00"')}</div>` + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], x ? String(!!x.active) : 'true')
    + templateSelect('noteTemplate', 'Notes for this service start from', x?.note_template ?? '')
    + select('selfBookEnabled', 'Patient self-booking', [['true', 'Enabled'], ['false', 'Disabled']], String(!!(x?.self_book_enabled ?? 1)))
    + field('selfBookNoticeMinutes', 'Minimum booking notice (minutes)', x?.self_book_notice_minutes ?? 120, 'number', 'required min="120" max="86400" step="1"')
    + select('selfBookPlanRequired', 'Plan of care for self-booking', [['false', 'Not required'], ['true', 'Active certified plan required']], String(!!(x?.self_book_plan_required ?? 0)))
    + select('selfBookAuthRequired', 'Authorization for self-booking', [['false', 'Not required'], ['true', 'Active authorization with visits available required']], String(!!(x?.self_book_auth_required ?? 0)))
}

const roomFields = (r?: any) => field('name', 'Room name', r?.name, 'text', 'required maxlength="80" placeholder="Treatment room 1"') + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], r ? String(!!r.active) : 'true')

/** On this computer an emailed link opens only in a browser that already opened Balm, so say how to sign in as this person instead. */
const localSignIn = (s: any, p: any) => !s.local ? '' : p.can_sign_in
  ? `<p class="help">Balm is running on this computer, so no email leaves it. To work as ${h(p.name)} in another browser, run <code>rer dev --as ${h(p.email)}</code> in the Balm folder and open the RER_OPEN link it prints.</p>`
  : `<p class="help">Balm is running on this computer, so no email leaves it. To work as ${h(p.name)}, first select <strong>Invite to sign in</strong>; then run <code>rer dev --as ${h(p.email)}</code> in the Balm folder and open the RER_OPEN link it prints, in another browser.</p>`
