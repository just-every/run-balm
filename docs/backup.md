A backup of Balm on your computer is one `.rer` archive made with `rer export`. A hosted Balm keeps its clinic in your Cloudflare account instead: it can back itself up on a schedule ([Automatic backups](#automatic-backups)), or you can save it by hand as in [Back up a hosted Balm](#back-up-a-hosted-balm). `rer export` never saves the hosted clinic, and refuses when you name a hosted address.

## Export

Stop Balm first, and keep exports private: they contain health records. The `exports/` folder and every `.rer` file are git-ignored, so `git add .` never commits a backup; copy them somewhere encrypted that only you can open.

```sh
rer dev --stop
rer export --output exports/balm.rer
```

The archive holds the clinic settings, staff, clients, appointments, intake answers, notes with every revision, invoices, payments, approvals, the access audit and move-in journals. Sessions, sign-in links, agent keys and secrets are not included: everyone signs in again.

## Automatic backups

A self-hosted Balm (on your computer or in your own Cloudflare account) can back the whole clinic up by itself, to storage you control, encrypted so that only you can open the result. Set it up once on **Clinic → Backups** (owner only):

1. **Make a key pair on your own computer**, in the Balm folder: `rer run backup:keygen`. It saves `exports/balm-backup-private-key.pem` (readable only by you) and prints a public key. Keep the private key somewhere safe and apart from the clinic. Balm never sees it: it encrypts each backup to the public key, so neither Balm, your hosting nor your storage can read one, and nobody can recover a lost key.
2. **Choose storage you control.** Any S3-compatible bucket: Amazon S3 (`https://s3.us-east-1.amazonaws.com`), Cloudflare R2 (`https://ACCOUNT.r2.cloudflarestorage.com`, region `auto`), MinIO, or a NAS in your office. Create a bucket and an access key allowed to write and list that bucket only, and use storage covered by a HIPAA business associate agreement with your practice.
3. **Paste the storage address, bucket, region, access key and the public key** on Clinic → Backups, tick that you understand how the backups are protected (your name and the time are recorded), and choose how often (every hour, 6, 12 or 24 hours; default daily). Saving writes one small connection-check file to prove the key works.

From then on Balm backs up on that schedule without anyone asking, and **Back up now** takes one at once. Each backup is a new object named `balm-backup-<time>-<id>.balmbk`: the same `.rer` archive `rer export` makes (clinic records, notes with every revision, the access audit, the erasure journal; not sessions, agent keys or secrets), inside an encrypted envelope. Balm only adds objects: it never deletes or overwrites a backup, so set the bucket's own rules for how long they stay. The **recovery point** (the moment the newest backup's snapshot was taken) leads your schedule and the Clinic page; it turns into a warning when the latest attempt failed, and Balm tries again fifteen minutes later. The storage secret is kept sealed in the database like the Stripe and scribe keys; the page never shows it again. RER Managed hosting has no outbound connection to your storage yet, so it says so instead.

### Restore drill

Prove a backup restores, somewhere else, without touching the clinic. On your own computer, in a Balm folder (`rer install` first), put your storage settings in a private file such as `backup.env` (`chmod 600`):

```sh
BALM_BACKUP_ENDPOINT=https://s3.us-east-1.amazonaws.com
BALM_BACKUP_REGION=us-east-1
BALM_BACKUP_BUCKET=my-clinic-backups
BALM_BACKUP_PREFIX=balm
BALM_BACKUP_ACCESS_KEY_ID=...
BALM_BACKUP_SECRET_ACCESS_KEY=...
```

```sh
rer run backup:drill -- --key exports/balm-backup-private-key.pem --env-file backup.env
```

The drill downloads your newest backup, decrypts it, restores it with `rer import` into a scratch copy of Balm in a private temporary folder, reads the clinic back, checks it against the backup's own counts, prints the recovery point and deletes the scratch copy (`--keep` leaves it).

### Restore from an automatic backup

```sh
rer run backup:restore -- --key exports/balm-backup-private-key.pem --env-file backup.env --output exports/balm-restored.rer
rer import --input exports/balm-restored.rer --yes
rer setup --owner-email original-owner@example.com
```

`backup:restore` takes the newest backup, or one you name with `--object KEY`, or a file you downloaded with `--input FILE`. A wrong key, a damaged or cut-short backup is refused and leaves no archive. Restoring an older backup also saves the newest as `<output>.later.rer`; pass it as the journal (`rer import --input OLD.rer --journal OLD.rer.later.rer --yes`, [After an erasure](#after-an-erasure)) so records erased since cannot come back.

Practice-owned hardware: point the storage at a MinIO or NAS bucket inside the office for the encrypted copy, and keep a second copy off site (the off-site target's business associate agreement belongs to `HIPAA-005`'s hosting record).

## Back up a hosted Balm

Run this in the Balm folder you deploy from, with the same Cloudflare settings you give `rer deploy` (in your environment, or your private settings file with `--env-file FILE`):

```sh
rer run backup:hosted -- --environment NAME
```

Leave out `--environment NAME` if you deployed without one. It saves the hosted clinic's whole database, every table and every record, as one SQL file such as `exports/balm-production-db-2026-10-17.sql`, readable only by you (mode 600), and prints its size, fingerprint and how many clients, visits, notes, invoices and audit entries it holds. Balm keeps no files outside its database, so this one file is the whole hosted clinic. The hosted Balm pauses for the few seconds the export takes. Underneath it runs Cloudflare's own export, `npx wrangler d1 export balm-production-db --remote --output exports/balm-production-db.sql`, with those settings; the database is named `balm-NAME-db` for an environment called NAME.

Keep the file as privately as a `.rer` archive: it holds health records.

## Restore a hosted backup

A hosted backup restores into a fresh copy of Balm on your computer, before setup and before any data:

```sh
git clone https://github.com/just-every/run-balm.git balm-restored
cd balm-restored
rer install
rer run restore:hosted -- --input ~/backups/balm-production-db-2026-10-17.sql
rer setup --owner-email original-owner@example.com
rer dev
```

The restore prints how many clients, visits, notes, invoices and audit entries came back, and the owner email to give `rer setup`. A copy that already holds data is refused, so two clinics never mix. Everyone signs in again; Stripe and the scribe key are sealed to the hosted copy, so connect them again on **Clinic**. From there, `rer export` makes a `.rer` archive of the restored clinic, and `rer deploy` can put it online again.

## Restore

Restore into a fresh copy of the same version of Balm, before setup and before any data:

```sh
rer install
rer import --input ~/backups/balm.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

Setup must use the archived owner's email. A damaged archive, or a copy that already holds data, is refused:

- **`target_not_empty`**: this copy already holds a clinic, and a restore never mixes two. Restore into a fresh copy, or keep this one with `rer export --output exports/before-restore.rer`, then `rer reset --yes` and import again.
- **`content_checksum` or `archive_checksum`**: the archive was damaged or changed after export. Use another copy.

## After an erasure

Pass a later archive as the journal so an older backup cannot bring erased details back:

```sh
rer import --input OLD.rer --journal LATER.rer --yes
```

`rer reset --yes` deletes the local data and settings; export first if you need them.
