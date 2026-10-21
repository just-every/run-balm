// An S3-compatible bucket faked at its HTTP edge. It checks every request's Signature V4 with its own
// implementation (so a signing bug in Balm fails here, as it would at AWS), enforces S3's rule that every
// multipart part but the last is at least 5 MiB, and keeps the bytes in memory. `fetchHandler` is the Worker's
// outbound edge; `serve()` puts the same bucket on 127.0.0.1 for the owner's Node scripts.
import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const checksum = data => createHash('sha256').update(data).digest('base64')
const sha = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const xml = (status, body, headers = {}) => new Response(body, { status, headers: { 'content-type': 'application/xml', ...headers } })
const problem = (status, code) => xml(status, `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`)

// Locked mode models Object Lock/bucket lock: upload checksums, no object replacement/deletion;
// unfinished multipart uploads can still be aborted. It does not establish live S3/R2 acceptance.
export function fakeBucket({ bucket = 'balm-backups', accessKeyId = 'synthetic-balm-key', secretAccessKey = 'synthetic-balm-secret', region = 'us-east-1', locked = false } = {}) {
  const objects = new Map(), uploads = new Map(), log = []
  const state = { refuse: 0, refusePart: 0 }
  let counter = 0

  async function verify(request, body) {
    const header = request.headers.get('authorization') ?? ''
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(header)
    if (!m) return 'MissingSignature'
    const [, key, day, scope, signedHeaders, signature] = m, url = new URL(request.url)
    if (key !== accessKeyId) return 'InvalidAccessKeyId'
    if (scope !== region) return 'AuthorizationHeaderMalformed'
    const payload = request.headers.get('x-amz-content-sha256')
    if (payload !== sha(body)) return 'XAmzContentSHA256Mismatch'
    const query = [...url.searchParams.entries()].map(([k, v]) => [encode(k), encode(v)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&')
    const names = signedHeaders.split(';'), host = url.host
    const canonical = [request.method, url.pathname, query, ...names.map(n => `${n}:${(n === 'host' ? host : request.headers.get(n) ?? '').trim()}`), '', signedHeaders, payload].join('\n')
    const stamp = request.headers.get('x-amz-date')
    const sign = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), 's3'), 'aws4_request')
    const expected = createHmac('sha256', sign).update(['AWS4-HMAC-SHA256', stamp, `${day}/${region}/s3/aws4_request`, sha(canonical)].join('\n')).digest('hex')
    return expected === signature ? null : 'SignatureDoesNotMatch'
  }

  async function fetchHandler(request) {
    const url = new URL(request.url), body = new Uint8Array(await request.arrayBuffer())
    const bad = await verify(request, body)
    if (bad) { log.push({ method: request.method, path: url.pathname, refused: bad }); return problem(403, bad) }
    if (state.refuse) { log.push({ method: request.method, path: url.pathname, refused: 'AccessDenied' }); return problem(state.refuse, 'AccessDenied') }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts[0] !== bucket) return problem(404, 'NoSuchBucket')
    const key = parts.slice(1).join('/'), q = url.searchParams
    const entry = { method: request.method, path: url.pathname, query: Object.fromEntries(q), bytes: body.length }
    log.push(entry)
    const reject = (status, code) => { entry.refused = code; return problem(status, code) }
    if (request.method === 'PUT') {
      const sent = request.headers.get('x-amz-checksum-sha256')
      if (locked && !sent) return reject(400, 'InvalidRequest')
      if (sent && sent !== checksum(body)) return reject(400, 'BadDigest')
    }
    if (locked && request.method === 'DELETE' && !q.has('uploadId')) return reject(403, 'AccessDenied')
    if (request.method === 'GET' && q.get('list-type') === '2') {
      const prefix = q.get('prefix') ?? ''
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort()
      return xml(200, `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${keys.map(k => `<Contents><Key>${k.replaceAll('&', '&amp;')}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`)
    }
    if (request.method === 'GET') return objects.has(key) ? new Response(objects.get(key)) : problem(404, 'NoSuchKey')
    if (request.method === 'PUT' && q.has('partNumber')) {
      if (state.refusePart) return reject(state.refusePart, 'AccessDenied')
      const upload = uploads.get(q.get('uploadId'))
      if (!upload) return problem(404, 'NoSuchUpload')
      upload.parts.set(Number(q.get('partNumber')), body)
      return new Response(null, { status: 200, headers: { etag: `"${sha(body).slice(0, 32)}"` } })
    }
    if (request.method === 'PUT') {
      // Backups are only ever added: a second write to the same name is Balm overwriting one.
      if (objects.has(key) && (locked || key.endsWith('.balmbk'))) return reject(409, 'OverwriteRefused')
      objects.set(key, body); return new Response(null, { status: 200, headers: { etag: `"${sha(body).slice(0, 32)}"` } })
    }
    if (request.method === 'POST' && q.has('uploads')) {
      if (locked && request.headers.get('x-amz-checksum-algorithm') !== 'SHA256') return reject(400, 'InvalidRequest')
      const id = `upload-${++counter}`; uploads.set(id, { key, parts: new Map() }); return xml(200, `<?xml version="1.0"?><InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`) }
    if (request.method === 'POST' && q.has('uploadId')) {
      const upload = uploads.get(q.get('uploadId'))
      if (!upload) return problem(404, 'NoSuchUpload')
      const parts = [...new TextDecoder().decode(body).matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(m => ({
        number: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]),
        etag: /<ETag>([^<]+)<\/ETag>/.exec(m[1])?.[1],
        checksum: /<ChecksumSHA256>([^<]+)<\/ChecksumSHA256>/.exec(m[1])?.[1],
      }))
      const numbers = parts.map(p => p.number)
      if (!numbers.length || numbers.some((n, i) => n !== i + 1 || !upload.parts.has(n))) return problem(400, 'InvalidPart')
      if (parts.some(p => p.etag !== `"${sha(upload.parts.get(p.number)).slice(0, 32)}"`)) return reject(400, 'InvalidPart')
      if (parts.some(p => (locked || p.checksum) && p.checksum !== checksum(upload.parts.get(p.number)))) return reject(400, 'BadDigest')
      if (objects.has(upload.key) && (locked || upload.key.endsWith('.balmbk'))) return reject(409, 'OverwriteRefused')
      if (numbers.slice(0, -1).some(n => upload.parts.get(n).length < 5 * 1024 * 1024)) return problem(400, 'EntityTooSmall')
      objects.set(upload.key, Buffer.concat(numbers.map(n => upload.parts.get(n)))); uploads.delete(q.get('uploadId'))
      return xml(200, '<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>')
    }
    if (request.method === 'DELETE' && q.has('uploadId')) { uploads.delete(q.get('uploadId')); return new Response(null, { status: 204 }) }
    return problem(405, 'MethodNotAllowed')
  }

  async function serve() {
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c)
      const response = await fetchHandler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }))
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
  }

  return { fetchHandler, serve, objects, uploads, log, state, config: { bucket, accessKeyId, secretAccessKey, region } }
}
