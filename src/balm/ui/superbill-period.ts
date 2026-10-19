import { field, h } from './shared'

export const periodSuperbillForm = (path: string) => `<details><summary>Superbill for a period</summary><form method="get" action="${h(path)}"><p>Include approved visits from both dates, in the clinic’s time zone. Every visit must have its billing identifiers and codes.</p><div class="pair">${field('from', 'From', '', 'date', 'required')}${field('to', 'Through', '', 'date', 'required')}</div><button type="submit">Download period superbill (PDF)</button></form></details>`
