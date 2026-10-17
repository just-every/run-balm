import { calendarStyle } from './styles/calendar'
import { contentStyle } from './styles/content'
import { controlsStyle } from './styles/controls'
import { ledgerStyle } from './styles/ledger'
import { pagesStyle } from './styles/pages'
import { shellStyle } from './styles/shell'

// Every app and public page's one inline sheet, allowed by its hash. Balm's
// tokens come from /rer-theme.css and /tokens.css; these sheets only use them.
export const style = shellStyle + controlsStyle + contentStyle + pagesStyle + calendarStyle + ledgerStyle
