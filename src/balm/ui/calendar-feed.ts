import { copyBox, form, h, panel } from './shared'

export function calendarFeedPanel(s: any, notice: any) {
  if (!s.calendarFeed) return ''
  const path = notice.result?.calendarFeedPath
  const link = path ? `${s.origin}${path}` : ''
  const address = link ? `${copyBox('calendar-feed', 'Private calendar address (shown once)', link)}
    <p class="help">In Google Calendar choose Other calendars → From URL; in Outlook choose Add calendar → Subscribe from web; in Apple Calendar choose File → New Calendar Subscription. Paste this address. Updates follow the calendar app’s refresh schedule.</p>` : ''
  const actions = form('calendar.feed.create', '/app#calendar-subscription', '', s.calendarFeed.active ? 'Replace private address' : 'Create private address')
    + (s.calendarFeed.active ? form('calendar.feed.revoke', '/app#calendar-subscription', '', 'Revoke calendar address', true) : '')
  return panel('Subscribe to your calendar', `<p>Your visits in Google Calendar, Outlook or Apple Calendar, with times and patient initials only. Keep this address private. Replacing or revoking it stops access at the old address.</p>${address}${actions}<p class="help">${h(s.calendarFeed.active ? 'A private address is active. If you no longer have it, replace it.' : 'No calendar address is active.')}</p>`, '', 'calendar-subscription')
}
