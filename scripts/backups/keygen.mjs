// Make the key pair for automatic backups, on your own computer. The private key stays in a file only you
// can read; paste the public key into Balm (Clinic → Backups). Balm can write backups with the public key
// but cannot read them, and a lost private key cannot be recovered by anyone.
//
//   node scripts/backups/keygen.mjs [--output exports/balm-backup-private-key.pem]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generateBackupKeys } from '../../src/balm/backup/envelope.mjs'
import { fail, flag } from './lib.mjs'

const output = resolve(flag('--output') ?? 'exports/balm-backup-private-key.pem')
if (existsSync(output)) fail(`${output} already exists. A key is never replaced: backups made for it could no longer be opened. Choose another name with --output.`)
const keys = await generateBackupKeys()
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, keys.privateKeyPem, { mode: 0o600, flag: 'wx' })
console.log(`Private key saved to ${output} (readable only by you). Keep a copy somewhere safe, apart from this clinic: without it no backup can be opened.`)
console.log(`Key ${keys.fingerprint}. Paste this public key into Balm (Clinic → Backups):\n\n${keys.publicKey}\n`)
