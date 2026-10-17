// The clinic's time zone: US zones by name first, then every zone the runtime
// knows. Until the owner saves it, the page fills in the browser's own zone.
import { h } from './shared'

const us: [string, string][] = [
  ['America/New_York', 'Eastern (New York)'], ['America/Chicago', 'Central (Chicago)'], ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Arizona (Phoenix, no daylight saving)'], ['America/Los_Angeles', 'Pacific (Los Angeles)'], ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'], ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'],
]
const everyZone = (): string[] => (Intl as any).supportedValuesOf?.('timeZone') ?? []

/** Fills an unsaved zone from the browser; the select keeps the saved one otherwise. */
export const browserZoneScript = "(()=>{const s=document.querySelector('select[data-browser-zone]'),z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(!s||!z)return;if(![...s.options].some(o=>o.value===z))s.add(new Option(z,z));s.value=z;const n=document.getElementById('zone-note');if(n)n.textContent='Filled in from this browser: '+z+'. Check it and save.'})()"

export function timeZoneField(settings: any) {
  const current = String(settings.time_zone), listed = new Set(us.map(([zone]) => zone))
  const rest = [...new Set([...everyZone(), current])].filter(zone => !listed.has(zone)).sort()
  const option = (zone: string, label: string) => `<option value="${h(zone)}"${zone === current ? ' selected' : ''}>${h(label)}</option>`
  const upcoming = Number(settings.upcoming ?? 0)
  const chosen = Number(settings.time_zone_chosen) === 1
  return `<label>Time zone<select name="timeZone" required${chosen ? '' : ' data-browser-zone'}><optgroup label="United States">${us.map(([zone, label]) => option(zone, label)).join('')}</optgroup><optgroup label="All time zones">${rest.map(zone => option(zone, zone)).join('')}</optgroup></select></label>`
    + `<p class="help" id="zone-note">${chosen ? `Every time Balm shows is in ${h(current)}.` : 'Not saved yet: choose your clinic’s time zone.'}</p>`
    + (upcoming ? `<label class="check"><input type="checkbox" name="confirmTimeZone" value="on"><span>If I change the time zone, the ${upcoming} upcoming ${upcoming === 1 ? 'visit keeps its' : 'visits keep their'} exact moment and ${upcoming === 1 ? 'shows' : 'show'} at the matching clock time in the new zone. Weekly hours stay the same clock times.</span></label>` : '')
}
