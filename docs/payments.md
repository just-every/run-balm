Patients pay through your clinic's own Stripe account: a card they save once, the copay charged when they check in, and a private link to their statement where they pay any balance and download receipts and superbills. Money goes straight to your Stripe account. Card numbers go to Stripe and never to Balm.

## Connect Stripe

1. In the Stripe Dashboard, open **Developers → API keys** and copy a secret key. A test-mode key (`sk_test_…`) lets you try everything with Stripe's test cards, such as `4242 4242 4242 4242`.
2. In Balm, the owner opens **Clinic → Online payments**, pastes the key and selects **Connect Stripe**.

Balm checks the key with Stripe and keeps it sealed. On an install with a public `https` address, Balm also creates the webhook through which Stripe reports each payment and saved card. A copy running on your own computer has no public address, so Balm reads each outcome back from Stripe when the patient returns to their link.

Online payment is **not available yet on RER Managed hosting**: it has no route out to Stripe until RER adds a provider relay. Run Balm yourself (on your own computer or your own Cloudflare account) to take payments. Check-in, statements, superbills and payments you record at the desk work everywhere.

## Superbill details

In **Clinic → Billing identifiers**, enter each practitioner's 10-digit **NPI**. Balm checks its check digit. The clinic's **Tax ID** comes from **Clinic details**; enter it before you approve invoices, because an invoice keeps the clinic details it was approved with.

## A card on file

In the patient's file, under **Card on file and copay**:

- **Email a card form** sends the patient a private link, or
- **Open the card form here** opens it on the front desk's screen for the patient to fill in.

The patient reads the clinic's authorization, which lets the clinic charge copays at check-in and balances on visits they attended, checks it, and enters their card on Stripe's page. Balm keeps the card's brand, last four digits and expiry, plus the exact authorization and the time the patient accepted it. A patient has one card on file, and a new card replaces the old one. **Remove card** takes it off Balm and out of your Stripe account.

Set the patient's **Copay per visit** in the same panel.

## Copay at check-in

On the **Schedule**, a visit booked for today shows **Check in and charge $30.00 copay to Visa ending 4242** when the patient has a copay and a card on file. One select checks the patient in and charges the card. The visit then shows **Copay $30.00 paid** and its receipt (`R-000001`), which is also emailed to the patient. If the bank declines the card, or asks the patient to confirm the charge, the patient is still checked in, the reason is shown, and you can try again or send a pay link. **Check in without charging** checks the patient in only, and a visit can be charged once.

The copay waits on the visit until its invoice is approved, and then counts toward that invoice.

## Pay links and statements

When a patient owes a balance, their file shows **Email a $65.00 pay link**, or **Open the pay page here**. The link works for 30 days and opens the patient's statement: every approved invoice and every payment across their visits, with a running balance and the balance due. From it the patient can:

- pay any amount up to the balance by card, on Stripe's page
- save a card for copays
- download the statement, each receipt and each visit's superbill as PDF files.

The email names your clinic and the amount only, never a service or diagnosis.

**Texting pay links** waits on your US A2P 10DLC registration, which carriers require before a business texts patients. Once it is approved, give your deploy the Twilio settings in `RUN-LOCALLY.md`, and the file also shows **Text a pay link**. Until then, send links by email.

## How payments are matched

A card payment is matched to invoices once: to the invoice it was charged for (or the visit's own invoice, for a copay) and then to the oldest open invoices. A patient who pays more than an invoice has left keeps the rest as credit, which is applied when their next invoice is approved. Stripe may report one payment several times: when the patient returns to their link, by webhook, or by a webhook repeated after a delay. Balm posts it once whichever comes first. Each card payment appears in the patient's file with its status and receipt, and the patient's audit records every check-in, saved card, charge, link and download.

## Superbills

Each approved invoice has a **Superbill (PDF)** under **Superbills** in the patient's file, and on the patient's link. A superbill lists:

- the clinic, its address and tax ID
- the rendering practitioner and their NPI
- the patient's name and date of birth
- the date of service
- the ICD-10 diagnoses
- the CPT codes with modifiers and units
- the charges, the amount paid and the balance.

Record the codes in the patient's file under **Visit codes**, for example `97161 GP, 97110 GP x2` and `M25.561, M54.50`. When the visit's signed treatment note billed CPT units, the superbill uses those instead. Until the NPI, the tax ID, a diagnosis and a CPT code are all present, the file names what is missing instead of offering the PDF.
