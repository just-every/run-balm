// Page forms in, command input out: the weekly-hours form becomes `hours.save`'s
// windows and the intake builder becomes `intake.prepare`'s questions. The JSON
// command doors keep taking those shapes directly (agents prepare intake versions).
import { DomainError, type Data } from './domain/model'
import { days } from './ui/hours'

const refuse = (sentence: string): never => { throw new DomainError(sentence, 400) }
const minute = (value: unknown) => {
  const match = typeof value === 'string' ? value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(:00)?$/) : null
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Each checked day's start and end, split by its breaks, as `{weekday, start, end}` windows. */
export function hoursFromForm(input: Data) {
  const windows: { weekday: number; start: string; end: string }[] = []
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  for (let weekday = 0; weekday < 7; weekday++) {
    if (input[`d${weekday}_open`] !== 'on') continue
    const name = days[weekday], start = minute(input[`d${weekday}_start`]), end = minute(input[`d${weekday}_end`])
    if (start === null || end === null) refuse(`${name}: enter a start and an end time, or uncheck ${name}.`)
    if (start! >= end!) refuse(`${name}: the end time must be after the start time.`)
    const breaks: [number, number][] = []
    for (let i = 0; i < 10; i++) {
      const from = input[`d${weekday}_break${i}_start`], until = input[`d${weekday}_break${i}_end`]
      if (!from && !until) continue
      const a = minute(from), b = minute(until)
      if (a === null || b === null) refuse(`${name}: a break needs both a start and an end time.`)
      if (a! >= b!) refuse(`${name}: a break must end after it starts.`)
      if (a! <= start! || b! >= end!) refuse(`${name}: a break must fall inside the working hours.`)
      breaks.push([a!, b!])
    }
    breaks.sort((x, y) => x[0] - y[0])
    let cursor = start!
    for (const [a, b] of breaks) {
      if (a < cursor) refuse(`${name}: two breaks overlap.`)
      windows.push({ weekday, start: hhmm(cursor), end: hhmm(a) }); cursor = b
    }
    windows.push({ weekday, start: hhmm(cursor), end: hhmm(end!) })
  }
  return windows
}

export type BuilderRow = { id: string; label: string; type: string; required: boolean }
export const questionTypes: [string, string][] = [['short', 'Short answer'], ['long', 'Long answer'], ['yes', 'Checkbox (yes or no)'], ['date', 'Date']]

/** The builder's rows as posted, in order; a row keeps its question id once it has one. */
export function builderRows(input: Data): BuilderRow[] {
  const count = Math.min(Math.max(Number(input.questionCount) || 0, 0), 60), list: BuilderRow[] = []
  for (let i = 0; i < count; i++) {
    const type = String(input[`q${i}_type`] ?? 'short')
    list.push({ id: String(input[`q${i}_id`] ?? ''), label: String(input[`q${i}_label`] ?? ''), type: questionTypes.some(([t]) => t === type) ? type : 'short', required: input[`q${i}_required`] === 'on' })
  }
  return list
}

/** Move up, move down, remove or add, applied to the unsaved rows. */
export function editRows(list: BuilderRow[], edit: string) {
  const [verb, at] = edit.split(':'), i = Number(at), next = [...list]
  if (verb === 'add') next.push({ id: '', label: '', type: 'short', required: false })
  if (verb === 'remove' && next[i]) next.splice(i, 1)
  if (verb === 'up' && i > 0 && next[i]) [next[i - 1], next[i]] = [next[i], next[i - 1]]
  if (verb === 'down' && i < next.length - 1 && next[i]) [next[i + 1], next[i]] = [next[i], next[i + 1]]
  return next
}

/** Rows to questions: empty new rows are dropped; a new question's id comes from its wording. */
export function questionsFromRows(list: BuilderRow[]) {
  const kept = list.filter(q => q.id || q.label.trim())
  if (!kept.length) refuse('Add at least one question.')
  const taken = new Set(kept.map(q => q.id).filter(Boolean))
  return kept.map((q, n) => {
    if (!q.label.trim()) refuse(`Question ${n + 1} needs its wording.`)
    if (q.label.trim().length > 300) refuse(`Question ${n + 1} is longer than 300 characters.`)
    let id = q.id
    if (!id) {
      const base = ('q_' + q.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 36).replace(/_+$/, '')
      id = base
      for (let k = 2; taken.has(id); k++) id = `${base}_${k}`
      taken.add(id)
    }
    return { id, label: q.label.trim(), type: q.type, required: q.required }
  })
}

/** An uploaded file carried between preview and import in a hidden field: base64, because browsers rewrite line breaks in submitted text. */
export function fileField(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export function fileFromField(value: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))
}
