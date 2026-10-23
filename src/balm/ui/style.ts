import {controlTooltipStyle} from './control-tooltip'
import { retentionStyle } from './retention-style'
import { moveinStyle } from './movein-style'
import { auditStyle } from './audit-style'
import { baseStyle } from './base-style'
import { shellStyle } from './shell-style'
import { calendarStyle } from './calendar-style'
import { todayStyle } from './today-style'
import { insuranceStyle } from './insurance-style'
import { casesStyle } from './cases-style'
import { ledgerStyle } from './payments-style'
import { intakePatientStyle } from './intake-patient'
import { pagesStyle } from './pages-style'

// The app's one stylesheet, in the owner-picked look; its colours, fonts and radii are tokens from public/rer-theme.css and public/fonts/fonts.css.
export const style = controlTooltipStyle + retentionStyle + baseStyle + shellStyle + calendarStyle + todayStyle + pagesStyle + ledgerStyle + insuranceStyle + casesStyle + intakePatientStyle + auditStyle + moveinStyle
