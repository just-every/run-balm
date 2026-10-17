# <img src="public/brand/mark.svg" alt="" width="36" height="36"> Balm

Online bookings, intake forms, private treatment notes and invoices for a US outpatient therapy clinic with 1–10 practitioners. Your clinic's records live on your own computer or in your own Cloudflare account, and every access to a client file is audited. This release does no insurance claiming. MIT licensed. [What the first release does](ACCEPTANCE.md) · [Docs](docs/getting-started.md).

> Balm is new. Keep real patient data out of it until your clinic has completed its own privacy review.

## Run it on your computer

Install Git, then run one line to install the `rer` launcher, clone Balm and start it:

```sh
npx -y @runeditrun/rer dev just-every/run-balm
```

No Node? `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-balm` does the same and brings its own Node; it changes no shell settings, so if it prints an `export PATH=…` line, run that line to use `rer` again later. To set Balm up without starting it, use `setup` in place of `dev`.

To start it again later, run `cd run-balm && rer dev`. `rer dev` installs the pinned dependencies and Node 22.20.0, prepares the local D1 database and a local owner, and starts the app. The first launch can take several minutes; if it is interrupted, run `rer dev` again. When it is ready it prints:

- `RER_READY http://127.0.0.1:<port>`: the app's address (the port is the first free one from 8787, and is kept for this checkout).
- `RER_OPEN …`: a private link that opens Balm signed in as the owner. Open it on this computer, check the confirmation and select **Finish setup**. Balm then asks for your clinic's time zone, filled in from your browser (US zones first); check it and select **Save and open the schedule**. Treat the link like a password.
- `RER_SITE http://127.0.0.1:<port>`: Balm's run site, served locally. Its **Run Balm** page is at `http://127.0.0.1:<port>/run`, using the `RER_SITE` port rer printed.

The public run site is at https://run-balm.com, and its **Run Balm** page is at https://run-balm.com/run. The local copy above serves the same pages.

To use your own email as the owner, run `npx -y @runeditrun/rer setup just-every/run-balm --owner-email you@example.com` in place of the one line, then `cd run-balm && rer dev`. Development and demo mail is silently suppressed; no messages are stored or shown. Stop with `rer dev --stop` or Ctrl-C. If the saved port is taken, choose a free one, for example `rer dev --port 8899`. Never expose the development server to the internet.

## Your first week

1. **Clinic**: enter your clinic's name, time zone (chosen at setup; change it here if needed), tax ID and address. Add a service with its length and price in dollars (for example `95.00`). Add each practitioner with their profession and provider number, which appear on invoices, and any reception staff. If you treat clients yourself, add yourself as a practitioner using your own sign-in email. Under each practitioner, **Set weekly hours**: check the days they work, and enter a start time, an end time and any break for each.
2. **Invite staff**: select **Invite to sign in** next to each person. A deployed Balm emails the invitation, and it opens in any browser. On your computer, work as a staff member by running `rer dev --as person@example.com` (with their email) in the Balm folder and opening the `RER_OPEN` link it prints, in another browser or profile.
3. **Online booking**: share `/book` on your app's address (`http://127.0.0.1:<port>/book` locally). A new client picks a service, a practitioner and an open time (at least two hours ahead, up to 60 days), enters their details and agrees to the clinic keeping their records. They land on their private intake link, which is also emailed to them. A slot someone else just took is refused.
4. **Intake**: the client completes the form once. Their answers appear in the client file for their practitioner and the owner. Reception sees only that the form was received. Edit the questions under **Intake form**: you prepare a new version, then publish it.
5. **Treatment notes**: the practitioner opens **Clients**, then the client's file, and writes a note against the appointment. Only that practitioner and the owner can read it. **Edit draft** keeps every earlier revision; once signed, a note changes only by **Add an addendum**.
6. **Invoices**: after the visit, mark the appointment **attended** on the **Schedule**. In the client file, **Prepare invoice**; then reception or the owner reviews and **Approve and number invoice**. **Download invoice** always returns the same file, for the client to pay. Record payments you receive elsewhere with a unique reference.
7. **Access audit**: as the owner, the bottom of every client file lists who opened the file, read intake answers or notes, changed something or downloaded an invoice, and when.

**Move in** brings a patient list across from Cliniko: upload Cliniko's patient export file, check the preview table (dates of birth are read as US MM/DD/YYYY unless you choose another format, and a date that could be read either way is flagged), import it, read the journal, or undo the import. See [Move in from Cliniko](docs/MOVE-IN.md) and try it with [the synthetic example](tests/fixtures/cliniko-export-us.csv).

**Agent access** creates a key so an assistant can prepare invoices, reminder text and intake form versions for a person to approve. Agents never read notes or intake answers. See the [agent commands](docs/AGENT-COMMANDS.md).

To remove someone's access at once, set them **Inactive** under **Clinic**. Erasing a client or staff member is only possible when they have no health records or clinic work; everyone else is kept, as health records must be.

## Back up and restore

Stop the app first, and keep exports private: they contain health records. The `exports/` folder and every `.rer` file are git-ignored, so `git add .` never commits a backup; copy them somewhere encrypted that only you can open.

```sh
rer dev --stop
rer export --output exports/balm.rer
```

To restore, use a fresh clone of the same revision, before setup or any data:

```sh
rer install
rer import --input /private/path/balm.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

Clinic settings, staff, clients, appointments, intake answers, notes with all revisions, invoices, payments, approvals, the access audit and move-in journals travel. Sessions, sign-in links, agent keys and secrets do not; sign in again. Setup must use the archived owner's email. Damaged archives and populated destinations are refused. After an erasure, pass a later archive as the journal so an older backup cannot bring erased details back: `rer import --input OLD.rer --journal LATER.rer --yes`. `rer reset --yes` deletes local data and settings; export first if you need them.

## Deploy to your own Cloudflare account

You need a Cloudflare account with an API token for Workers and D1, and a SendGrid or Resend account with a verified sender address. No domain is needed: Balm runs on its `workers.dev` address. The full steps, with where to find each value, are in [Deploy to your own Cloudflare account](docs/deploy.md).

1. Set up Balm on your computer with your own email as the owner (`npx -y @runeditrun/rer setup just-every/run-balm --owner-email you@example.com`, then `cd run-balm`).
2. Provide these as environment variables from your secret manager, or in a private `chmod 600` file passed with `--env-file PATH` (never in commands or committed files):
   - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`;
   - `MAIL_PROVIDER`: required, `sendgrid` or `resend`;
   - `MAIL_API_KEY`: that provider's API key;
   - `MAIL_FROM`: the sender address every Balm email comes from, verified with that provider;
   - `OWNER_EMAIL` only if the hosted owner should differ from the one you set up.

   rer generates `SESSION_SECRET` and `SETUP_TOKEN` itself and keeps them in `.rer/deploy/` (mode 0600).
3. Check, then deploy:

```sh
rer deploy --dry-run
rer deploy
```

The dry run builds and validates without contacting Cloudflare and names any missing setting. `rer deploy` creates the Worker and D1 database, applies the migrations, uploads the settings as secrets, checks health and claims the owner. Open the printed address and sign in with the owner email. If mail is not working yet, `rer signin` recovers owner access. Keep the resource names in `wrangler.jsonc` and `deploy.json` unchanged. Add `--environment NAME` to every `rer deploy` command to run a separate copy.

To remove the deployment (export first if you want its records), run:

```sh
rer deploy --remove --yes
```

It deletes the Worker and D1 database rer created for that environment, confirms each is gone, and touches nothing else.

## Develop

Balm pins `@runeditrun/rer@0.2.40` (package mode) and started from Base's committed foundation `ada9f574d8a7247edc3a1180b593ad182b1fbb37`. See [source adaptation](docs/SOURCES.md), [local operations](RUN-LOCALLY.md) and the [agent guide](AGENTS.md).

```sh
pnpm run test:balm
pnpm run test:archive
pnpm run test:site
pnpm run typecheck
rer verify
```

The tests run the real Worker on workerd and D1 through its public doors (sign-in, booking, intake links, the command API and the agent door) plus the public `rer export`/`rer import` CLI. Builds and deploys run no tests. The run site (`rer build --site`: the homepage, `/run` and the docs built from `docs/*.md`) is in `src/site`; the app's screens use Base's theme until their design round.
