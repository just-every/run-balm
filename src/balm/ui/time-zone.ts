// The clinic's time zone: US zones by name first, then every zone the runtime
// knows. A new install has none: the owner's first page in the app asks for it,
// filled in from the owner's browser, before the schedule or online booking opens.
import { form, h, hidden } from './shared'

const us: [string, string][] = [
  ['America/New_York', 'Eastern (New York)'], ['America/Chicago', 'Central (Chicago)'], ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Arizona (Phoenix, no daylight saving)'], ['America/Los_Angeles', 'Pacific (Los Angeles)'], ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'], ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'],
]
// The runtime still lists some zones by their old names; people read the current ones.
const renamed: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv', 'Atlantic/Faeroe': 'Atlantic/Faroe', 'America/Godthab': 'America/Nuuk', 'Pacific/Enderbury': 'Pacific/Kanton',
}
const zoneName = (zone: string) => renamed[zone] ?? zone
const everyZone = (): string[] => (Intl as any).supportedValuesOf?.('timeZone') ?? []

/** A zone as people read it: "Central time (America/Chicago)" for a US zone, the zone's own name otherwise. */
export const zoneLabel = (zone: string) => {
  const named = us.find(([id]) => id === zone)?.[1]
  return named ? `${named.replace(/ \(.*$/, '')} time (${zone})` : zoneName(zone)
}

/** Fills an unsaved zone from the browser and says so beside the field. */
export const browserZoneScript = "(()=>{const s=document.querySelector('select[data-browser-zone]'),z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(!s||!z)return;const o=[...s.options].find(o=>o.value===z||o.text===z);if(!o)s.add(new Option(z,z));s.value=o?o.value:z;const n=document.getElementById('zone-note');if(n)n.textContent='This browser is set to '+s.options[s.selectedIndex].text+(s.options[s.selectedIndex].text===z?'':', '+z)+'. Balm uses it unless you choose another zone.'})()"

export function timeZoneField(settings: any) {
  const current = String(settings.time_zone ?? ''), listed = new Set(us.map(([zone]) => zone))
  const rest = [...new Set([...everyZone(), current])].filter(zone => zone && !listed.has(zone)).sort((a, b) => zoneName(a).localeCompare(zoneName(b)))
  const option = (zone: string, label: string) => `<option value="${h(zone)}"${zone === current ? ' selected' : ''}>${h(label)}</option>`
  const upcoming = Number(settings.upcoming ?? 0)
  const chosen = Number(settings.time_zone_chosen) === 1
  return `<label>Time zone<select name="timeZone" required${chosen ? '' : ' data-browser-zone'}>${current ? '' : '<option value="">Choose your clinic’s time zone</option>'}<optgroup label="United States">${us.map(([zone, label]) => option(zone, label)).join('')}</optgroup><optgroup label="All time zones">${rest.map(zone => option(zone, zoneName(zone))).join('')}</optgroup></select></label>`
    + `<p class="help" id="zone-note">${chosen ? `Every time Balm shows is in ${h(zoneLabel(current))}.` : 'Not saved yet: choose your clinic’s time zone.'}</p>`
    + (upcoming ? `<label class="check"><input type="checkbox" name="confirmTimeZone" value="on"><span>If I change the time zone, the ${upcoming} upcoming ${upcoming === 1 ? 'visit keeps its' : 'visits keep their'} exact moment and ${upcoming === 1 ? 'shows' : 'show'} at the matching clock time in the new zone. Weekly hours stay the same clock times.</span></label>` : '')
}

/** The owner's first page in the app until a zone is saved; staff are told the owner sets it. */
export function timeZoneStep(s: any, returnTo: string) {
  const st = s.settings
  if (s.actor.role !== 'owner') return '<h1>Almost ready</h1><p>The clinic owner is choosing the clinic’s time zone. The schedule opens here once it is saved.</p>'
  const keep = hidden('bookingOpen', String(!!st.booking_open))
  return '<h1>Your clinic’s time zone</h1><p>Balm shows every visit, reminder and record in your clinic’s time zone, and online booking offers times in it. Check the zone below, then save to open the schedule.</p>'
    + `<section class="panel">${form('settings.save', returnTo, `<label>Clinic name<input name="clinicName" type="text" value="${h(st.clinic_name === 'My clinic' ? '' : st.clinic_name)}" required maxlength="120" placeholder="Riverside Physical Therapy"></label>` + timeZoneField(st) + keep, 'Save and open the schedule')}</section>`
    + '<p class="help">You can change the name and zone later on the Clinic page.</p>'
}
