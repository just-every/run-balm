// Automatic backups are encrypted before they leave Balm, to a public key the owner generates and keeps
// the private half of: the hosted Balm (and the bucket) can write a backup but never read one. A backup is
// one `.rer` archive in this envelope: a magic line, one JSON header line, then framed AES-256-GCM
// ciphertext. The 256-bit data key is wrapped with RSA-OAEP (SHA-256) for the owner's public key; each
// frame's nonce and authenticated data bind its position and whether it is the last, so a reordered or
// truncated backup is refused. Web Crypto only: it runs in the Worker and in the owner's Node scripts.
export const MAGIC = 'BALMBK1\n'
export const PUBLIC_PREFIX = 'balm-backup-public-v1:'
const FRAME = 1024 * 1024
const encoder = new TextEncoder(), decoder = new TextDecoder()
const subtle = globalThis.crypto.subtle

export const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text) }
export const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const digest = async bytes => new Uint8Array(await subtle.digest('SHA-256', bytes))
const fingerprint = async spki => 'sha256:' + hex((await digest(spki)).subarray(0, 8))
const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length } return out }

/** A new key pair. The private key is PKCS#8 PEM for the owner to keep; Balm is only ever given `publicKey`. */
export async function generateBackupKeys() {
  const pair = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['wrapKey', 'unwrapKey'])
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey)), pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
  const lines = toBase64(pkcs8).match(/.{1,64}/g).join('\n')
  const label = 'PRIVATE KEY'
  const pem = `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
  return { publicKey: PUBLIC_PREFIX + toBase64(spki), privateKeyPem: pem, fingerprint: await fingerprint(spki) }
}

/** Reads the owner's pasted public key; throws a short reason when it is not one Balm can use. */
export async function readPublicKey(text) {
  const value = String(text ?? '').trim()
  if (!value.startsWith(PUBLIC_PREFIX)) throw new Error('paste_the_public_key_printed_by_backup_keygen')
  let spki, key
  try { spki = fromBase64(value.slice(PUBLIC_PREFIX.length)); key = await subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['wrapKey']) }
  catch { throw new Error('the_public_key_is_not_valid') }
  if (key.algorithm.modulusLength < 3072) throw new Error('the_public_key_is_too_short')
  return { key, publicKey: value, fingerprint: await fingerprint(spki) }
}

const nonce = (prefix, counter) => { const iv = new Uint8Array(12); iv.set(prefix); new DataView(iv.buffer).setBigUint64(4, BigInt(counter)); return iv }
const aad = (header, counter, last) => { const out = new Uint8Array(header.length + 9); out.set(header); new DataView(out.buffer).setBigUint64(header.length, BigInt(counter)); out[header.length + 8] = last ? 1 : 0; return out }

async function* frames(source, size) {
  let buffer = new Uint8Array(0), held = null
  for await (const piece of source) {
    buffer = buffer.length ? concat([buffer, piece]) : piece
    while (buffer.length >= size) {
      if (held) yield [held, false]
      held = buffer.slice(0, size); buffer = buffer.slice(size)
    }
  }
  if (held) yield [held, !buffer.length]
  if (buffer.length || !held) yield [buffer, true]
}

/** Encrypts `source` (an async iterable of byte chunks) for the public key; yields the envelope's chunks. */
export async function* encryptBackup(source, publicKey, createdAt = new Date().toISOString()) {
  const recipient = await readPublicKey(publicKey)
  const data = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']), prefix = globalThis.crypto.getRandomValues(new Uint8Array(4))
  const wrapped = new Uint8Array(await subtle.wrapKey('raw', data, recipient.key, { name: 'RSA-OAEP' }))
  const header = encoder.encode(JSON.stringify({ v: 1, alg: 'RSA-OAEP-256+AES-256-GCM-FRAMES', key: recipient.fingerprint, wrappedKey: toBase64(wrapped), nonce: toBase64(prefix), frame: FRAME, createdAt }) + '\n')
  yield encoder.encode(MAGIC); yield header
  let counter = 0
  for await (const [plain, last] of frames(source, FRAME)) {
    const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, counter), additionalData: aad(header, counter, last) }, data, plain))
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, sealed.length)
    yield concat([length, sealed]); counter++
  }
}

/** Pulls exact byte counts and lines from an async iterable of chunks. */
function reader(source) {
  const iterator = source[Symbol.asyncIterator]()
  let buffer = new Uint8Array(0), ended = false
  const fill = async () => {
    if (ended) return false
    const next = await iterator.next()
    if (next.done) { ended = true; return false }
    buffer = buffer.length ? concat([buffer, next.value]) : next.value
    return true
  }
  return {
    async take(n) { while (buffer.length < n) if (!await fill()) return null; const out = buffer.slice(0, n); buffer = buffer.slice(n); return out },
    async line() { for (;;) { const at = buffer.indexOf(10); if (at >= 0) { const out = buffer.slice(0, at + 1); buffer = buffer.slice(at + 1); return out } if (!await fill()) return null } },
    async done() { while (!buffer.length) if (!await fill()) return true; return false },
  }
}

/** Decrypts an envelope with the owner's PKCS#8 PEM private key. Refuses a wrong key, damage, reordering and truncation. */
export async function* decryptBackup(source, privateKeyPem) {
  const input = reader(source)
  const magic = await input.take(MAGIC.length)
  if (!magic || decoder.decode(magic) !== MAGIC) throw new Error('not_a_balm_backup')
  const header = await input.line()
  if (!header) throw new Error('not_a_balm_backup')
  const meta = JSON.parse(decoder.decode(header))
  if (meta.v !== 1 || meta.alg !== 'RSA-OAEP-256+AES-256-GCM-FRAMES') throw new Error('unsupported_backup_version')
  let data
  try {
    const der = fromBase64(String(privateKeyPem).replace(/-----[A-Z ]+-----|\s/g, ''))
    const priv = await subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey'])
    data = await subtle.unwrapKey('raw', fromBase64(meta.wrappedKey), priv, { name: 'RSA-OAEP' }, { name: 'AES-GCM' }, false, ['decrypt'])
  } catch { throw new Error('wrong_backup_key') }
  const prefix = fromBase64(meta.nonce)
  for (let counter = 0;; counter++) {
    const length = await input.take(4)
    if (!length) throw new Error('backup_truncated')
    const size = new DataView(length.buffer, length.byteOffset).getUint32(0)
    if (size < 16 || size > meta.frame + 16) throw new Error('backup_damaged')
    const sealed = await input.take(size)
    if (!sealed) throw new Error('backup_truncated')
    const last = await input.done()
    let plain
    try { plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce(prefix, counter), additionalData: aad(header, counter, last) }, data, sealed)) }
    catch { throw new Error('backup_damaged') }
    yield plain
    if (last) return
  }
}
