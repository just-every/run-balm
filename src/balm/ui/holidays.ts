import { empty, field, form, h, hidden, panel, usDate } from './shared'
export function holidaysPanel(s: any) {
  const holidays = JSON.parse(s.settings.holidays ?? '[]')
  return panel('Clinic holidays', '<p>Named all-day closures in the clinic time zone. Existing visits stay booked for you to resolve; new bookings and moves are refused on these dates.</p>'
    + (holidays.map((x: any) => `<p><strong>${h(x.name)}</strong> · ${h(usDate(x.date, 'UTC'))}</p>` + form('holiday.save', '/app/clinic', hidden('date', x.date) + hidden('remove', 'on'), 'Remove closure', true)).join('') || empty('No holidays recorded.'))
    + form('holiday.save', '/app/clinic', field('date', 'Holiday date', '', 'date', 'required') + field('name', 'Holiday name', '', 'text', 'required maxlength="120"'), 'Save holiday'))
}
