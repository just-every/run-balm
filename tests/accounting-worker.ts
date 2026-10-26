import worker from './worker'

// Money journeys pin both sides of the native HTTP boundary to one clinic day.
const OriginalDate = Date
class AccountingDate extends OriginalDate {
  constructor(value?: string | number) { super(value === undefined ? '2026-10-20T02:00:00.000Z' : value) }
  static now() { return OriginalDate.parse('2026-10-20T02:00:00.000Z') }
}
globalThis.Date = AccountingDate as DateConstructor
export default worker
