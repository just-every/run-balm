# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. Without it, start with
`npx -y @runeditrun/rer dev just-every/run-balm` (set up only:
`npx -y @runeditrun/rer setup just-every/run-balm`; without Node:
`curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-balm`). `rer dev` alone launches
a fresh checkout for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Open the printed `RER_OPEN` link to sign in as the owner. Development
and demo mail is silently suppressed. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`. Local dev
sign-in uses the checkout’s private key; keep `RER_OPEN` private. Private
settings are kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. The foundation has no product-domain tables or background jobs; an
edition's archive contains the supported domain tables and resources that its
adapter declares. Owner/auth, outbox, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
export/import/export equivalence across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, plus the mail settings `MAIL_PROVIDER` (`sendgrid` or
`resend`), `MAIL_API_KEY` and `MAIL_FROM` (a sender the provider has verified),
all from the environment or `--env-file`; rer generates the session and setup
secrets and uses the set-up owner unless `OWNER_EMAIL` is given. `rer deploy
--remove --yes` deletes what the deploy created. Steps: `docs/deploy.md`.
Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

## Automatic backup custody and retention

On Clinic → Backups the owner supplies an S3-compatible bucket and only the public half of an owner-held key pair. Keep the private key in two safe places away from this server and this bucket; without it no backup can be restored. A lost private key makes every backup made to it unrecoverable; destroying it leaves them all unreadable. Storage credentials are sealed under the install secret and never shown again.

Set an expiry rule on the bucket: Balm never deletes or overwrites backups, so records you erase or destroy stay encrypted in older backups until that rule removes them. To protect against ransomware, turn on S3 Object Lock (governance mode) or an R2 bucket lock for no longer than that expiry, and where your provider allows it, give Balm a key that cannot delete objects. Unfinished multipart uploads are aborted. Run `rer run backup:drill` after setup and whenever you change the key.

`backup:restore --object KEY` saves the newest backup’s journal beside an older restore; give that journal to `rer import` to fence later erasures. A fresh destination without the newer journal cannot know about them. RER Managed hosting offers no backups. See [backup setup and recovery](docs/backup.md). Live receipts against Amazon S3 and Cloudflare R2, and the off-site backup target’s BAA record, belong to `HIPAA-005`.

## Hosted installation package

`packaging.json` declares Balm’s build, setup, verification, recovery and mail policy. After the real `pnpm run build`, run `pnpm delivery:spec` to refresh the committed deployment specification and `pnpm check:deployment-spec` to verify it. Package the Worker, assets and unchanged migrations with `node scripts/delivery/base/cli.mjs package --config packaging.json --output rer-package`; generated output stays private and ignored.

Managed email uses the assigned `MAIL_PROVIDER`, `MAIL_FROM`, `MAIL_RELAY_URL` and private `MAIL_API_KEY`. Assisted installs select their own provider and verified sender in the setup manifest. Development and demo mail remain suppressed. Follow [the backup and recovery guide](docs/backup.md) before moving a clinic or applying migrations.
