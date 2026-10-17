# Changelog

## 0.1.0 (17 Oct 2026)

Balm's first release: practice software for a US outpatient physical, occupational or speech therapy clinic with 1 to 10 practitioners, which you run on your own computer or in your own Cloudflare account. It books, takes intake, keeps signed treatment notes and plans of care, reminds patients, bills them and takes their payments, with every access to a client file audited. It is MIT licensed and charges nothing.

### What an owner gets

- **Clinic setup.** Clinic name, time zone (filled in from your browser, US zones first), tax ID and address; services with a length and a price in dollars; practitioners with their profession, NPI and credentials, and reception staff; each practitioner's weekly hours with breaks, set with checkboxes and times. A first-run checklist shows what is left.
- **Staff and roles.** Invite practitioners and reception to sign in (a hosted Balm emails the invitation). Practitioners see only the clients they are booked with; reception sees every file but never intake answers or notes; setting someone **Inactive** stops their access on the next page they open. On your computer, `rer dev --as their@email` signs in as an invited person.
- **Schedule.** A day or week calendar by practitioner or room, in the clinic's time zone. Book, move (by the form or a drag) and cancel visits at any 5-minute start inside the practitioner's hours; a visit that overlaps the practitioner or the room is refused. Recurring series show every conflicting date before saving, and one visit or the rest of a series can be moved or canceled.
- **Online booking.** Share `/book`: a new patient picks a service, a practitioner and a real open quarter hour (2 hours to 60 days ahead) and lands on their private intake link, which is also emailed. A time someone else just took is refused, with the patient's details kept and the open times offered.
- **Intake.** The patient sends the form once from their private link; the answers are bound to the form version and readable only by their practitioner and the owner. Change the questions with the form builder: prepare a new version, then publish it.
- **Waitlist.** A visit canceled at least two hours ahead is offered by email to everyone waiting whose practitioner, service and dates fit; the first to accept is booked, and the others are told it is taken.
- **Treatment notes.** PT, OT and speech templates for evaluations, daily notes, progress reports and discharge summaries. Drafts keep every revision; the author signs the exact latest revision with their name and credentials, the note locks, and later changes are signed addenda. CPT minutes give 8-minute-rule units on the note and its invoice. The schedule shows which visits still need a signed note.
- **Plan of care.** The therapist signs a plan of care and sends it to the referring physician, who certifies it once from a private emailed link without an account; the case and schedule show it signed or not.
- **Scribe.** With your own Anthropic or OpenAI-compatible key, entered on Clinic, the scribe drafts an unsigned note in the visit's template from dictation or bullet points; it never signs.
- **Invoices and payments.** Prepare an invoice from an attended visit; a person approves it, and only then is it numbered and its downloadable file fixed, so every download is the same bytes. Record payments received elsewhere once per reference. With your own Stripe account, a patient saves a card from their private link with your authorization, the desk checks them in and charges the copay in one action with a numbered receipt, and an approved invoice is charged to the card or paid from a pay link sent by email. The patient's link shows a statement across visits, receipts and per-visit superbills (CPT, ICD-10, NPI, tax ID) as PDFs.
- **Automatic reminders.** Balm emails reminders on the lead times you set (for example a day and an hour before), one per lead time and never two at once; the patient confirms or asks for a new time from the email's private link, and the file shows each reminder's outcome. Moved visits get a new schedule; canceled visits stop their reminders. Reminder text an agent or staff prepares under **Invoices and reminders** is separate: you approve it and send it yourself.
- **Secure messages.** Patient and clinic exchange messages on a private page; the email holds only a generic notice and the link, never clinical text, and only the owner and treating practitioners read the content.
- **Access audit.** Every opening of a client file, read of intake answers or notes, change, download and agent read is listed in words on that file, append-only, for the owner only.
- **Agent access.** An owner-made key lets an assistant read names, appointments and invoices and prepare invoices, reminder text and intake form versions; only a signed-in person approves them, and each approval keeps the digest of what was approved. Agents never read notes or intake answers.
- **Move in from Cliniko.** Upload Cliniko's patient export, check the preview (US MM/DD/YYYY dates by default; a date that reads either way is flagged), import it, read the journal with the original file, and undo it without losing patients who have since been booked or edited.
- **Your data.** Balm runs on your computer with `npx -y @runeditrun/rer dev just-every/run-balm`, or in your own Cloudflare account with `rer deploy` and your own SendGrid or Resend sender. `rer export` and `rer import` back up and restore the clinic on your computer; `rer run backup:hosted` and `rer run restore:hosted` do the same for a hosted clinic. A client or staff member with no health records can be erased, and an older backup cannot bring them back.
- Pinned `@runeditrun/rer` 0.2.43.

### Not in this release

- Insurance billing: no eligibility checks, authorizations, claims (Claim.MD or Availity), ERA posting, denials, or Medicare therapy-cap (KX) tracking. Superbills let patients claim from their insurer themselves.
- Text messages: reminders, waitlist offers and pay links go by email. Texting is built behind a Twilio adapter but stays off until your clinic's US A2P 10DLC registration is approved and its settings are deployed; there are no inbound texts.
- A signed-in patient portal, home exercise programs, insurance card or document uploads, and signed consent forms (the intake has a required consent checkbox).
- Telehealth video, referrals and fax, the case agent, reports, and multi-location clinics.
- Moving in from WebPT, SimplePractice or Jane, or moving appointments, notes and balances from Cliniko (patients only).
- Online payment and the scribe on RER Managed hosting, which says "not available yet" until its outbound relay ships; both work on your own computer and your own Cloudflare account.
- Balm is new: keep real patient data out of it until your clinic has completed its own privacy review.

### Back up first

Balm keeps health records, so make a backup before you change anything, and keep it somewhere private and encrypted.

**On your computer**, in your `run-balm` folder:

```sh
rer dev --stop
rer export --output exports/balm-before-0.1.0.rer
```

**Hosted**, from the folder you deploy from, with the Cloudflare settings you give `rer deploy`:

```sh
rer run backup:hosted -- --environment NAME
```

Leave out `--environment NAME` if you deployed without one. `rer export` saves only the clinic on your computer and refuses a hosted address; the hosted backup is one SQL file in `exports/`, readable only by you. [Back up and restore](docs/backup.md) shows how to restore either.

**If you ran Balm from `main` before this release**, back up as above, then `git pull` and `rer dev` on your computer, or `git pull` and `rer deploy` for a hosted copy. The migrations apply in order and keep your clinic.

### Known issues

- On your computer, the cancel confirmation still says "Balm emails [patient] that it is canceled"; no email leaves your computer, and the visit is canceled correctly.
- On your computer, a waitlist offer is recorded as "Not emailed" and its private acceptance link is not shown, so the offer can only be accepted on a hosted Balm.
- ICD-10 diagnoses are typed under **Visit codes** for the superbill; notes keep diagnoses as free text.
- Recording a payment larger than the invoice's outstanding amount is refused, but the message says "Someone changed this at the same time" instead of naming the amount; nothing is recorded.

### Fixed during release review

- **Saving a card and paying online work on a new Stripe account**: a Stripe account opened now starts on Stripe's newest API version, which refused Balm's Checkout with "The `payment_method_types` parameter is no longer supported", so patients could neither save a card on file nor pay a balance from their link. Balm now names the Stripe API version it is tested against (`2026-09-30.endive`) on every Stripe call and on the webhook it creates, and asks Checkout for card with `allowed_payment_method_types`. Copays charged to the card on file at check-in are unchanged.
- **Back up a hosted clinic**: `rer run backup:hosted -- --environment NAME` saves the hosted clinic's whole database as one SQL file in `exports/`, readable only by you, and `rer run restore:hosted -- --input FILE` restores it into a fresh copy of Balm before setup (a copy that already holds data is refused). The deploy page's take-down steps and Back up and restore name these commands; `rer export` saves only the clinic on your computer and refuses a hosted address.
- **Automatic reminders**: each lead time sends one reminder, never two at once. A visit booked after one or more lead times have passed gets a single reminder at the next minute, and later lead times still send on schedule. The Clinic page says so.
- **Reminders say one thing**: Clinic's automatic visit reminders are the ones Balm emails; **Invoices and reminders → Prepared reminders** is text you approve, download and send yourself, and each page says how it differs from the other.
- **Booking**: staff can book or move a visit to any 5-minute start inside the practitioner's hours (4:10 is no longer refused as "outside weekly hours"); online booking still offers quarter hours, and the forms say both.
- **Staff on your computer**: the Clinic page says to select **Invite to sign in** before `rer dev --as their@email`, and says only the command once they are invited.
- **Texting**: the hint links to the deploy guide's settings where texting is set up, and is no longer repeated under Online payments.
- **On your computer, Balm no longer says it emailed anyone**: bookings, plans of care, secure messages, pay links, receipts, the waitlist and the patient's booking page say no email leaves this computer, and show the private link where there is one.
- **Smaller fixes**: deactivated staff see a page that says their access is off instead of raw JSON; an NPI entered as a provider number fills Billing identifiers; Visit codes shows CPT billed from a signed note; the access audit names actions in words ("Opened the file") and counts "All N entries"; the Stripe refusal says when a key is incomplete; the physician's signed page shows the Balm header once; Check in and Mark attended no longer touch; the built-in intake form has no made-up publish date; time zones show their current names (Asia/Kolkata, Europe/Kyiv); the deploy page says to stop `rer dev` first; the restore refusals are explained in plain words.
