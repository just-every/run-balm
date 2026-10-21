// The owner's backup storage is any S3-compatible bucket: Amazon S3, Cloudflare R2's S3 API, MinIO or a
// NAS in the practice's office. Path-style addressing and Signature V4 only, over plain `fetch`, so the
// hosted Worker and the owner's Node scripts speak to it the same way. Balm only ever writes new objects:
// it never overwrites a backup and never deletes one (the owner's bucket rules decide how long they stay).
const encoder = new TextEncoder()
const subtle = globalThis.crypto.subtle
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async data => hex(await subtle.digest('SHA-256', data))
const base64Hash = hash => btoa(String.fromCharCode(...hash.match(/../g).map(byte => parseInt(byte, 16))))
const hmac = async (key, data) => new Uint8Array(await subtle.sign('HMAC', await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(data)))
const escape = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
export const PART_BYTES = 8 * 1024 * 1024

export class StorageError extends Error {}

/** Where the backups go: https only (plain http only to this computer), with the bucket and its credentials. */
export function storage({ endpoint, region, bucket, prefix = '', accessKeyId, secretAccessKey }, { loopback = false } = {}) {
  let url
  try { url = new URL(String(endpoint)) } catch { throw new StorageError('the_storage_address_is_not_valid') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(loopback && local && url.protocol === 'http:')) throw new StorageError('the_storage_address_must_be_https')
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new StorageError('the_storage_address_is_the_service_only')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new StorageError('the_bucket_name_is_not_valid')
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw new StorageError('the_region_is_not_valid')
  const folder = String(prefix).replace(/^\/+|\/+$/g, '')
  if (folder.length > 200 || /[^\w./-]|\.\./.test(folder)) throw new StorageError('the_folder_is_not_valid')
  return { origin: url.origin, region, bucket, prefix: folder ? folder + '/' : '', accessKeyId, secretAccessKey }
}

async function call(target, method, key, { query = {}, body, headers = {}, now = new Date(), fetcher = globalThis.fetch } = {}) {
  const path = '/' + [target.bucket, ...(key ? key.split('/') : [])].map(escape).join('/')
  const search = Object.entries(query).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${escape(k)}=${escape(v)}`).join('&')
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = stamp.slice(0, 8), payload = await sha(body ?? new Uint8Array(0))
  const host = new URL(target.origin).host
  const signed = { host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp, ...(method === 'PUT' ? { 'x-amz-checksum-sha256': base64Hash(payload) } : {}), ...headers }
  const names = Object.keys(signed).map(n => n.toLowerCase()).sort()
  const canonical = [method, path, search, ...names.map(n => `${n}:${String(Object.entries(signed).find(([k]) => k.toLowerCase() === n)[1]).trim()}`), '', names.join(';'), payload].join('\n')
  const scope = `${day}/${target.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha(encoder.encode(canonical))].join('\n')
  let k = await hmac(encoder.encode('AWS4' + target.secretAccessKey), day)
  for (const part of [target.region, 's3', 'aws4_request']) k = await hmac(k, part)
  const signature = hex(await hmac(k, toSign))
  const { host: _host, ...send } = signed
  const response = await fetcher(target.origin + path + (search ? '?' + search : ''), { method, body, headers: { ...send, authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }, redirect: 'manual' })
  return response
}
const fail = async (response, doing) => {
  const text = await response.text().catch(() => '')
  const code = /<Code>([^<]{1,60})<\/Code>/.exec(text)?.[1]
  throw new StorageError(`${doing} was refused by the storage (${response.status}${code ? ' ' + code : ''})`)
}

export async function putObject(target, key, body, options) {
  const response = await call(target, 'PUT', target.prefix + key, { ...options, body, headers: { 'content-type': 'application/octet-stream' } })
  if (!response.ok) await fail(response, 'Writing the backup')
  await response.body?.cancel()
}

/** Writes an async iterable of chunks as one new object, in multipart pieces once it passes one part. */
export async function putStream(target, key, source, options = {}) {
  const full = target.prefix + key
  let buffer = [], size = 0, total = 0, upload, etags = [], checksums = []
  const take = () => { const out = new Uint8Array(size); let at = 0; for (const piece of buffer) { out.set(piece, at); at += piece.length } buffer = []; size = 0; return out }
  const flush = async () => {
    const part = take()
    if (!upload) {
      const response = await call(target, 'POST', full, { ...options, query: { uploads: '' }, headers: { 'content-type': 'application/octet-stream', 'x-amz-checksum-algorithm': 'SHA256' } })
      if (!response.ok) await fail(response, 'Starting the backup upload')
      upload = /<UploadId>([^<]+)<\/UploadId>/.exec(await response.text())?.[1]
      if (!upload) throw new StorageError('the storage did not start a multipart upload')
    }
    const response = await call(target, 'PUT', full, { ...options, query: { partNumber: String(etags.length + 1), uploadId: upload }, body: part })
    if (!response.ok) await fail(response, 'Writing a backup part')
    const etag = response.headers.get('etag'); await response.body?.cancel()
    if (!etag) throw new StorageError('the storage did not return a part receipt')
    etags.push(etag); checksums.push(base64Hash(await sha(part)))
  }
  try {
    for await (const chunk of source) {
      buffer.push(chunk); size += chunk.length; total += chunk.length
      if (size >= PART_BYTES) await flush()
    }
    if (!upload) { await putObject(target, key, take(), options); return { bytes: total } }
    if (size) await flush()
    const xml = '<CompleteMultipartUpload>' + etags.map((tag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${tag}</ETag><ChecksumSHA256>${checksums[i]}</ChecksumSHA256></Part>`).join('') + '</CompleteMultipartUpload>'
    const done = await call(target, 'POST', full, { ...options, query: { uploadId: upload }, body: encoder.encode(xml), headers: { 'content-type': 'application/xml' } })
    const text = await done.text()
    // S3 can answer 200 with an error body for a failed completion.
    if (!done.ok || /<Error>/.test(text)) throw new StorageError('Finishing the backup upload was refused by the storage')
    return { bytes: total }
  } catch (error) {
    if (upload) await call(target, 'DELETE', full, { ...options, query: { uploadId: upload } }).then(r => r.body?.cancel(), () => {})
    throw error
  }
}

/** Object keys under the backup folder, oldest first (keys carry their UTC time, so name order is time order). */
export async function listObjects(target, options) {
  const keys = []
  let token
  do {
    const response = await call(target, 'GET', '', { ...options, query: { 'list-type': '2', prefix: target.prefix, ...(token ? { 'continuation-token': token } : {}) } })
    if (!response.ok) await fail(response, 'Listing the backups')
    const text = await response.text()
    for (const [, key] of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(key.replaceAll('&amp;', '&'))
    token = /<IsTruncated>true<\/IsTruncated>/.test(text) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text)?.[1] : undefined
  } while (token)
  return keys.sort()
}

/** The object's bytes as a stream. */
export async function getObject(target, key, options) {
  const response = await call(target, 'GET', key, options)
  if (!response.ok) await fail(response, 'Reading the backup')
  return response.body
}
