import { h, panel, usDate } from './shared'

const groups = [
  ['notes', 'Unsigned notes'], ['plans', 'Plans of care'], ['charges', 'Visits without charges'],
  ['copays', 'Uncollected copays'], ['claims', 'Claims not sent'], ['intakes', 'Intakes not returned'],
  ['authorizations', 'Authorizations running out'], ['eligibility','Coverage to review'],
] as const

export function dailyClosePanel(s: any) {
  const close = s.dailyClose
  if (!close) return ''
  const codeSets=close.codeSets??[]
  const total = codeSets.length + groups.reduce((sum, [key]) => sum + close[key].length, 0)
  return panel('Daily close', `<p>Outstanding work through ${h(usDate(close.date + 'T12:00:00Z', 'UTC'))} in ${h(close.zone)}, including earlier days. Current records are checked each time you open this page.</p>
    <div data-daily-close>${total ? `<p>${total} outstanding items. Open a record to finish it.</p>` : '<p role="status">Daily close is clear.</p>'}
    ${codeSets.length?`<section data-close-category="codeSets"><h3>Code releases to update · ${codeSets.length}</h3><ul>${codeSets.map((c:any)=>`<li><a href="/app/clinic#clinical-codes">${h(c.message)}</a></li>`).join('')}</ul></section>`:''}<div class="grid">${groups.map(([key, title]) => `<section data-close-category="${key}"><h3>${h(title)} · ${close[key].length}</h3>${close[key].length ? `<ul class="plain">${close[key].map((item: any) => `<li><a href="${h(item.href)}">${h(item.client)}</a><br>${h(item.label)}</li>`).join('')}</ul>` : '<p class="help">Nothing outstanding.</p>'}</section>`).join('')}</div></div>`, 'full', 'daily-close')
}
