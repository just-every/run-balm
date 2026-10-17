import type { DateFormat } from '../formats.ts'

export function calendarDate(value: string, format: DateFormat): { value: string; ambiguous: boolean } {
  let iso = value, ambiguous = false
  const local = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value)
  if (local) {
    if (format === 'YMD') throw new Error('Use a YYYY-MM-DD date or choose MDY/DMY.')
    const [month, day] = format === 'MDY' ? [local[1], local[2]] : [local[2], local[1]]
    iso = `${local[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    ambiguous = +month <= 12 && +day <= 12 && +month !== +day
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || +iso.slice(0, 4) < 1 || !Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error('A real calendar date is required.')
  return { value: iso, ambiguous }
}

/** Requires an explicit offset: never interprets source times in the server's zone. */
export function timestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('Use an ISO timestamp including Z or a UTC offset, for example 2026-11-02T09:00:00-05:00. Local times require conversion in the clinic time zone.')
  calendarDate(match[1], 'YMD')
  if (+match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59) throw new Error('The time is invalid.')
  const offset = match[6]
  if (offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))) throw new Error('The UTC offset is invalid.')
  const milliseconds = Date.parse(value.replace(' ', 'T'))
  if (!Number.isFinite(milliseconds)) throw new Error('The appointment timestamp is invalid.')
  return new Date(milliseconds).toISOString()
}

/** Decimal string arithmetic, with no floating-point multiplication or rounding. */
export function usdCents(value: string): number {
  let amount = value.trim(), negative = false
  if (amount.startsWith('(') && amount.endsWith(')')) { negative = true; amount = amount.slice(1, -1) }
  if (amount.startsWith('-')) { if (negative) throw new Error('Use one negative sign.'); negative = true; amount = amount.slice(1) }
  if (amount.startsWith('$')) amount = amount.slice(1)
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount)) throw new Error('Use a USD amount with at most two decimal places, for example 125.50 or (20.00).')
  const [whole, fraction = ''] = amount.replaceAll(',', '').split('.')
  const integer = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The amount exceeds the exact supported cents range.')
  return Number(negative ? -integer : integer)
}
