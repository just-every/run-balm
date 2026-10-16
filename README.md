# Balm

Online bookings, intake forms, private treatment notes and invoices for an Australian physio, psychology or podiatry clinic with 1–10 practitioners. Your clinic's records live in your own Cloudflare account, and every access to a client file is audited. Balm does no Medicare, DVA, NDIS or health-fund claiming. MIT licensed. [What the first release does](ACCEPTANCE.md).

> Balm is new. Keep real patient data out of it until your clinic has completed its own privacy review.

## Run it on your computer

Install Git and Node 22 or newer, then run one line. It clones Balm, installs the `rer` launcher and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-balm
```

To start it again later, run `cd run-balm && rer dev`. `rer dev` installs the pinned dependencies and Node 22.20.0, prepares the local D1 database and a local owner, and starts the app. The first launch can take several minutes; if it is interrupted, run `rer dev` again. When it is ready it prints:

- `RER_READY http://127.0.0.1:<port>`: the app's address (the port is the first free one from 8787, and is kept for this checkout).
- `RER_OPEN …`: a private link that opens Balm signed in as the owner. Open it on this computer, tick the confirmation and select **Finish setup**. Treat the link like a password.
- `RER_SITE http://127.0.0.1:<port>`: Balm's run site, served locally. Its **Run Balm** page is at `http://127.0.0.1:<port>/run`, using the `RER_SITE` port rer printed.

The public run site, https://run-balm.com, goes live once its domain is registered. Until then the run site exists only locally, as above.

To use your own email as the owner, run `rer install`, then `rer setup --owner-email you@example.com`, then `rer dev`. Local development sends no real email: messages wait in **Local mail** inside the app. Stop with `rer dev --stop` or Ctrl-C. If the saved port is taken, choose a free one, for example `rer dev --port 8899`. Never expose the development server to the internet.

## Your first week

1. **Clinic**: enter your clinic's name, time zone (an IANA name such as `Australia/Sydney`; it is fixed after the first booking), ABN and address. Add a service with its length and price in cents (for example `9500` for $95.00). Add each practitioner with their profession and provider number, which appear on invoices, and any reception staff. If you treat clients yourself, add yourself as a practitioner using your own sign-in email. Under each practitioner, **Set weekly hours** (weekday 0 is Sunday; times are 24-hour clinic time).
2. **Invite staff**: select **Invite to sign in** next to each person. To try a second person on this computer, open the terminal's `RER_OPEN` link in a separate browser profile first, then **Sign out** there. Back in your own browser, open **Local mail**, and open the invitation link in the second profile. A deployed Balm emails invitations instead.
3. **Online booking**: share `/book` on your app's address (`http://127.0.0.1:<port>/book` locally). A new client picks a service, a practitioner and an open time (at least two hours ahead, up to 60 days), enters their details and agrees to the clinic keeping their records. They land on their private intake link, which is also emailed to them. A slot someone else just took is refused.
4. **Intake**: the client completes the form once. Their answers appear in the client file for their practitioner and the owner. Reception sees only that the form was received. Edit the questions under **Intake form**: you prepare a new version, then publish it.
5. **Treatment notes**: the practitioner opens **Clients**, then the client's file, and writes a note against the appointment. Only that practitioner and the owner can read it. **Amend this note** keeps every earlier revision, with your reason.
6. **Invoices**: after the visit, mark the appointment **attended** on the **Schedule**. In the client file, **Prepare invoice**; then reception or the owner reviews and **Approve and number invoice**. **Download invoice** always returns the same file, for the client to pay and claim from their fund. Record payments you receive elsewhere with a unique reference.
7. **Access audit**: as the owner, the bottom of every client file lists who opened the file, read intake answers or notes, changed something or downloaded an invoice, and when.

**Move in** brings a patient list across from a [Cliniko patient export](docs/MOVE-IN.md): preview, apply, then read the journal, or undo the import. Try it with [the synthetic example](tests/fixtures/cliniko-patients.csv).

**Agent access** creates a key so an assistant can prepare invoices, reminder text and intake form versions for a person to approve. Agents never read notes or intake answers. See the [agent commands](docs/AGENT-COMMANDS.md).

To remove someone's access at once, set them **Inactive** under **Clinic**. Erasing a client or staff member is only possible when they have no health records or clinic work; everyone else is kept, as health records must be.

## Back up and restore

Stop the app first, and keep exports private: they contain health records.

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

You need a Cloudflare account, an API token for Workers and D1, and a verified sender address with [Resend](https://resend.com) for sign-in links and intake emails. No domain is needed: Balm runs on its workers.dev address, and a custom domain is optional.

1. Set `MAIL_FROM` in `deploy.json` to your verified sender and commit that change.
2. Provide these as environment variables from your secret manager (never in commands or files): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `SESSION_SECRET`, `SETUP_TOKEN` and `MAIL_API_KEY`.
3. Check, then deploy:

```sh
rer deploy --dry-run
rer deploy
```

The dry run builds and validates without contacting Cloudflare. `rer deploy` creates the Worker and D1 database, applies the migrations, uploads the secrets, checks health and claims the owner. Open the printed address and sign in with the owner email. If mail is not working yet, `rer signin` recovers owner access. Keep the resource names in `wrangler.jsonc` and `deploy.json` unchanged.

## Develop

Balm pins `@runeditrun/rer@0.2.22` (package mode) and started from Base's committed foundation `ada9f574d8a7247edc3a1180b593ad182b1fbb37`. See [source adaptation](docs/SOURCES.md), [local operations](RUN-LOCALLY.md) and the [agent guide](AGENTS.md).

```sh
pnpm run test:balm
pnpm run test:archive
pnpm run typecheck
rer verify
```

The tests run the real Worker on workerd and D1 through its public doors (sign-in, booking, intake links, the command API and the agent door) plus the public `rer export`/`rer import` CLI. Builds and deploys run no tests. Screens use Base's theme; a visual design round comes next.
