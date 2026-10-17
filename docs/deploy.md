Run Balm in your own Cloudflare account, so your staff and patients can reach it from anywhere. No domain is needed: Balm runs on its `workers.dev` address, and a custom domain is optional.

## What you need

- **A Cloudflare account** and its **Account ID** (on the dashboard's **Workers & Pages** overview page).
- **A Cloudflare API token**: in Cloudflare, open **My Profile → API Tokens → Create Token**, start from the **Edit Cloudflare Workers** template, add the permission **Account → D1 → Edit**, and create it.
- **A mail provider** for sign-in links, invitations, intake links, waitlist offers and cancellations. Balm works with either:
  - **SendGrid**: verify a sender under **Settings → Sender Authentication** (a single sender, or your domain), then create a key under **Settings → API Keys** with **Mail Send** access.
  - **Resend**: verify your domain under **Domains**, then create a key under **API Keys** with sending access.
- **Balm on your computer**, set up with your own email as the owner. If you have not done this yet, run this and then `cd run-balm`:

```sh
npx -y @runeditrun/rer setup just-every/run-balm --owner-email you@example.com
```

## The settings

Give `rer deploy` these settings as environment variables from your password manager or secret store, or in a private file (`chmod 600`) passed with `--env-file PATH`. Never type them into a command or commit them.

| Setting | What to put |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID. |
| `CLOUDFLARE_API_TOKEN` | The API token you created. |
| `MAIL_PROVIDER` | Required: `sendgrid` or `resend`. |
| `MAIL_API_KEY` | The SendGrid or Resend API key. |
| `MAIL_FROM` | The address every Balm email is sent from, for example `frontdesk@example.com`. It must be a SendGrid verified sender, or an address at your Resend-verified domain. It is a setting like the others, not part of any file in the repository. |
| `OWNER_EMAIL` | Optional. The owner who signs in first; without it, rer uses the owner you set up on your computer. |
| `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Optional; leave them out. They turn on texting pay links once your clinic is registered to text patients (US carriers call this A2P 10DLC registration). The dry run lists them as "optional secrets not supplied", which is expected. |

You do not create `SESSION_SECRET` or `SETUP_TOKEN`: rer generates them for a new deployment, keeps them privately in `.rer/deploy/` in your Balm folder (mode 0600), and reuses them each time you deploy again.

## Deploy

From your Balm folder, stop Balm on your computer first (`rer deploy` refuses while `rer dev` runs, and names this command):

```sh
rer dev --stop
rer deploy --dry-run
rer deploy
```

The dry run builds and checks everything on your computer without contacting Cloudflare, and lists any setting that is still missing. `rer deploy` then creates the Worker and its D1 database, applies the database changes, uploads the settings as secrets, checks the app is healthy and makes your owner email the owner. It prints the app's address, such as `https://balm-production.<your-subdomain>.workers.dev`.

Open that address, enter the owner email and select the sign-in link that arrives. Then set up your clinic as on your computer: [Set up your clinic](/docs/set-up-your-clinic). Invitations to staff now arrive by email and open in any browser.

To run a second, separate copy (for example to try things out), add `--environment NAME` to every `rer deploy` command, with a short name such as `trial`. Each environment has its own Worker, database and address.

To deploy a newer version of Balm later, update your Balm folder (`git pull`) and run `rer deploy` again. Your data stays.

## Remove a deployment

Removing deletes the hosted database. Back up the hosted clinic first if you want to keep its records:

```sh
rer run backup:hosted -- --environment NAME
rer deploy --remove --yes --environment NAME
```

The backup is one SQL file in `exports/`, readable only by you, that restores into a fresh copy of Balm ([Back up a hosted Balm](/docs/backup#back-up-a-hosted-balm)). `rer export` does not do this: it saves only the clinic on your computer, and refuses a hosted address. Leave out `--environment NAME` if you deployed without one.

This deletes the Worker and the D1 database that `rer deploy` created for this environment, checks with Cloudflare that each is gone, and touches nothing else in your account. The address stops working at once.

## If something goes wrong

- **The dry run lists missing settings**: add each one it names and run it again.
- **Sign-in emails do not arrive**: check `MAIL_FROM` is verified with your provider and `MAIL_API_KEY` belongs to the same provider as `MAIL_PROVIDER`. Until mail works, `rer signin` prints an owner sign-in link.
- Keep the names in `wrangler.jsonc` and `deploy.json` unchanged: rer finds your Worker and database by them.
