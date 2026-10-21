// Turn an encrypted backup into a `.rer` archive you can restore with `rer import` into a fresh Balm.
//
//   node scripts/backups/restore.mjs --key exports/balm-backup-private-key.pem (--input FILE | --env-file backup.env [--object KEY])
//        [--output exports/balm-restored.rer]
//
// --input names a backup file you downloaded; otherwise the newest backup in your bucket is used (or --object
// names one). Restoring an older backup also saves the newest as <output>.later.rer: pass it as the journal,
// `rer import --input OLD.rer --journal OLD.rer.later.rer --yes`, so records erased since cannot come back.
import { backupsIn, decryptTo, fail, fileSource, flag, objectSource, privateKey, storageFromEnvironment, summary } from './lib.mjs'

const key = privateKey()
const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
const output = flag('--output') ?? `exports/balm-restored-${stamp}.rer`
const input = flag('--input')
if (input) {
  const manifest = await decryptTo(fileSource(input), key, output)
  console.log(`Decrypted ${input} to ${output}: ${summary(manifest)}.`)
} else {
  const target = storageFromEnvironment(), keys = await backupsIn(target), newest = keys.at(-1), chosen = flag('--object') ?? newest
  if (!keys.includes(chosen)) fail(`${chosen} is not a backup in that bucket and folder`)
  const manifest = await decryptTo(await objectSource(target, chosen), key, output)
  console.log(`Restored ${chosen} to ${output}: ${summary(manifest)}.`)
  if (chosen !== newest) {
    const later = `${output}.later.rer`
    await decryptTo(await objectSource(target, newest), key, later)
    console.log(`The newest backup is saved as ${later}: restore with  rer import --input ${output} --journal ${later} --yes  so erased records stay erased.`)
  }
}
console.log(`Next, in a fresh copy of Balm (rer install; nothing set up yet):  rer import --input ${output} --yes  then  rer setup --owner-email <the clinic's owner>.`)
