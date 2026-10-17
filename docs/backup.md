A backup of Balm on your computer is one `.rer` archive made with `rer export`. A hosted Balm keeps its clinic in your Cloudflare account instead: back that up as in [Back up a hosted Balm](#back-up-a-hosted-balm). `rer export` never saves the hosted clinic, and refuses when you name a hosted address.

## Export

Stop Balm first, and keep exports private: they contain health records. The `exports/` folder and every `.rer` file are git-ignored, so `git add .` never commits a backup; copy them somewhere encrypted that only you can open.

```sh
rer dev --stop
rer export --output exports/balm.rer
```

The archive holds the clinic settings, staff, clients, appointments, intake answers, notes with every revision, invoices, payments, approvals, the access audit and move-in journals. Sessions, sign-in links, agent keys and secrets are not included: everyone signs in again.

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
