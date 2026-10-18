import { insist, text, type Data } from '../domain/model'

export type Signature = { kind: 'drawn'; strokes: number[][][] } | { kind: 'typed'; name: string }
export type Photo = { bytes: Uint8Array<ArrayBuffer>; mime: string }
export const PHOTO_LIMIT = 1_900_000
const BODY_LIMIT = 15 * 1024 * 1024

export function signature(input: Data): Signature {
  if (input.signatureTyped) return { kind: 'typed', name: text(input.signatureTyped, 'typed_signature', 150) }
  let strokes = input.signature
  if (typeof strokes === 'string') {
    insist(strokes.length < 150_000, 'signature_too_large')
    try { strokes = JSON.parse(strokes) } catch { insist(false, 'draw_or_type_your_signature') }
  }
  insist(Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 80, 'draw_or_type_your_signature')
  let count = 0, left = 1, right = 0, top = 1, bottom = 0
  const result = strokes.map((stroke: unknown) => {
    insist(Array.isArray(stroke) && stroke.length >= 2, 'invalid_signature')
    return stroke.map((p: unknown) => {
      insist(Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1), 'invalid_signature')
      insist(++count <= 4000, 'signature_too_large')
      left = Math.min(left, p[0]); right = Math.max(right, p[0]); top = Math.min(top, p[1]); bottom = Math.max(bottom, p[1])
      return p.map(n => Math.round(n * 10000) / 10000)
    })
  })
  insist(count >= 4 && right - left + bottom - top > 0.06, 'draw_or_type_your_signature')
  return { kind: 'drawn', strokes: result }
}

export function photo(value: unknown): Photo | null {
  if (value === undefined || value === null || value === '') return null
  insist(typeof value === 'string' && value.length <= Math.ceil(PHOTO_LIMIT / 3) * 4 + 100, 'card_photo_too_large')
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  insist(match, 'card_photo_must_be_jpeg_png_or_webp')
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)) } catch { insist(false, 'invalid_card_photo') }
  insist(bytes.length > 12 && bytes.length <= PHOTO_LIMIT, 'card_photo_too_large')
  const mime = match[1]
  insist(mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/png' ? [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
      : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP', 'invalid_card_photo')
  return { bytes, mime }
}

export const base64 = (bytes: Uint8Array) => {
  let value = ''
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(value)
}

/** Bounded intake body; file uploads use the same validation as JSON data URLs. */
export async function parseIntakeInput(request: Request): Promise<Data> {
  insist(Number(request.headers.get('content-length') ?? 0) <= BODY_LIMIT, 'intake_upload_too_large', 413)
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
  if (reader) while (true) {
    const part = await reader.read(); if (part.done) break
    size += part.value.byteLength
    if (size > BODY_LIMIT) { await reader.cancel(); insist(false, 'intake_upload_too_large', 413) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const type = request.headers.get('content-type') ?? ''
  const copy = new Request(request.url, { method: 'POST', headers: { 'content-type': type }, body: bytes })
  if (type.includes('application/json')) {
    let input: unknown; try { input = await copy.json() } catch { insist(false, 'invalid_json') }
    insist(input && typeof input === 'object' && !Array.isArray(input), 'expected_an_object')
    return input as Data
  }
  insist(type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded'), 'use_json_or_a_form', 415)
  let data: FormData; try { data = await copy.formData() } catch { insist(false, 'invalid_intake_form') }
  const input: Data = {}
  for (const [key, value] of data) {
    insist(!(key in input), 'duplicate_intake_field')
    if (typeof value === 'string') input[key] = value
    else {
      insist(['insuranceFront', 'insuranceBack', 'secondaryFront', 'secondaryBack', 'identityPhoto'].includes(key), 'unexpected_intake_file')
      if (!value.size) continue
      insist(value.size <= PHOTO_LIMIT, 'card_photo_too_large', 413)
      input[key] = `data:${value.type};base64,${base64(new Uint8Array(await value.arrayBuffer()))}`
      photo(input[key])
    }
  }
  return input
}
