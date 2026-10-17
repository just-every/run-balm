import { insist, type Data } from '../domain/model'
import { uploadField } from './attachments'

/** Bound the streamed body even when the caller omits Content-Length. */
export async function parseMessageInput(request: Request): Promise<Data> {
  const max = 1_400_000
  insist(Number(request.headers.get('content-length') ?? 0) <= max, 'message_upload_too_large', 413)
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
  if (reader) while (true) {
    const part = await reader.read(); if (part.done) break
    size += part.value.byteLength
    if (size > max) { await reader.cancel(); insist(false, 'message_upload_too_large', 413) }
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
  let form: FormData; try { form = await copy.formData() } catch { insist(false, 'invalid_message_form') }
  const input: Data = {}
  for (const [key, value] of form) {
    insist(!(key in input), 'duplicate_message_field')
    if (typeof value === 'string') input[key] = value
    else {
      insist(key === 'attachment', 'unexpected_message_file')
      if (value.size) Object.assign(input, await uploadField(value))
    }
  }
  return input
}
