# Balm homepage claims → code (run-site gate table)

Branch `br/style` on just-every/run-balm, 17 Oct 2026. Every capability the homepage states, in page order, with the code that backs it today, **partly** (a narrower version exists, named) or **contract, not yet in code**. The copy is the design desk's (owner-accepted 16 Oct 2026) and is not watered down; this table is what the run-site gate reads before any deploy.

Note on "the contract": the brief describes Balm's new contract (a US outpatient therapy practice system replacing WebPT and Jane: scheduling, intake and portal, discipline-specific documentation, reminders, cash-pay and insurance billing through to collection). `CONTRACT.md` on `main` (unchanged since b7532cd) is still the first-release contract (BALM-001: bookings, intake links, private notes, invoices approved and numbered, append-only audit; "No hosted provider delivery, claiming integration or real-export compatibility is claimed"), and `seed.json` still lists insurance claiming and telehealth as non-goals. So every **contract** row below is backed only by the brief's description of the new contract, not by a file on `main`.

Status key: **code** = the capability exists and runs today; **partly** = a narrower version exists (named), the claimed form does not; **contract** = contract, not yet in code.

| # | Section | Claim on the page | Status | Code path / what exists |
|---|---|---|---|---|
| 1 | Hero | "runs your clinic's schedule" | code | A calendar by day or week, by practitioner or by room, in the clinic time zone, visits shown by status (booked, attended, did not attend; canceled in the list): `src/balm/domain/calendar.ts`, `src/balm/ui/calendar.ts`, `src/balm/ui/schedule.ts`. Move by drag (`src/balm/ui/drag.ts`) or the edit form; a move is refused on an overlap of the practitioner or the room, or outside hours, in the same batch (`moveAppointment`, `placementGuards` in `src/balm/domain/booking.ts`). Online and staff booking as before. |
| 2 | Hero | "intake" | code | One-use intake link per booking, answers bound to the form version: `src/balm/domain/intake.ts`, `src/balm/ui/public.ts`, `src/balm/ui/intake.ts`. |
| 3 | Hero | "notes" | partly | Free-text treatment notes per visit, author-and-owner only, amended as revisions: `src/balm/domain/notes.ts`, `src/balm/ui/clients.ts`. No templates or signatures. |
| 4 | Hero | "reminders" | partly | Exact reminder text prepared, approved and downloaded; Balm sends nothing: `src/balm/domain/reminders.ts`, `src/balm/ui/invoices.ts`. |
| 5 | Hero | "bills insurance … through to paid" | contract | No eligibility, claims, ERA or payer code (`seed.json` non-goals). |
| 6 | Hero | "bills … patients through to paid" | code | Invoice → card or pay link → paid: an approved invoice is charged to the card on file (`pay.invoice.charge`) or paid by the patient from their private `/pay/<token>` link in Stripe Checkout; each Stripe payment posts to invoices once (`stripe:<intent>:<invoice>` references, a status fence in the same D1 batch), however often Stripe reports it (return, webhook, replay): `src/balm/payments/charges.ts`, `src/balm/payments/ledger.ts`; tested in `tests/payments.test.mjs`. Desk payments recorded once per reference as before. Self-hosted installs; RER Managed says online payment is not available yet (no egress relay). |
| 7 | Hero | "100% free, open source" | code | `LICENSE` (MIT); nothing is charged anywhere in the code. |
| 8 | Hero card | Tuesday schedule with visits | code | `src/balm/ui/schedule.ts` (the day list). |
| 9 | Hero card | "daily note" signed (check) | partly | As row 3: a note exists per visit; no signing step. |
| 10 | Hero card | "Plan of care signed by Dr. Patel" | contract | No plan of care or physician signature. |
| 11 | Hero card | "Auth: 8 of 12 visits left" | contract | No authorization tracking. |
| 12 | Hero card | "Claim paid · Aetna · $142.18" | contract | As row 5. |
| 13 | Hero card | "Reminder sent" | partly | As row 4: prepared and approved text; not sent by Balm. |
| 14 | Hero card | "Denied: missing KX modifier · Resubmitted" | contract | No claims or denial handling. |
| 15 | Scheduling | "Recurring visits" | code | A series (weekdays, start time, weeks) is checked date by date before saving; a date that overlaps, hits a booked room or falls outside hours is shown and must be moved or skipped by a person, and all visits book in one batch: `src/balm/domain/series.ts`, `src/balm/ui/series.ts`. Edit or cancel one visit, or move or cancel the rest of the series. Tested in `tests/schedule.test.mjs`. |
| 16 | Scheduling | "waitlists" | code | A waitlist per practitioner (or any) and service with a date window: `src/balm/domain/waitlist.ts`, `src/balm/ui/waitlist.ts`, `/app/waitlist`. |
| 17 | Scheduling | "online booking keep[s] the calendar full" | code | `/book`: 15-minute starts inside practitioner hours, 2 hours to 60 days ahead, race-safe insert: `src/balm/domain/booking.ts`, `src/balm/ui/public.ts`. New clients (an exact name, birth date and email match continues a file). |
| 18 | Scheduling | "offers the slot to your waitlist by text" / "Confirmed by text" | partly | A canceled visit at least two hours ahead is offered by **email** to every fitting waitlist entry; the first to accept at `/offer/<token>` is booked in the same batch that closes the offer, gets the confirmation with the intake link, and the others are emailed that it is taken (`src/balm/domain/waitlist.ts`, `src/balm/mail-out.ts`; tested in `tests/schedule.test.mjs`). Not by text: no SMS provider is connected (US A2P registration is the owner's), and the Waitlist page says text offers are not available yet. |
| 19 | Intake | "Patients fill in intake … from one link" | code | As row 2. |
| 20 | Intake | "sign consent" | partly | The default form's required consent checkbox (`migrations/core/0015_balm.sql`, form `intake-v1`); no signature capture. |
| 21 | Intake | "add their insurance card" | contract | No file or card upload. |
| 22 | Intake | "Their home exercises … live in the same portal" | contract | No patient portal or exercise programs. |
| 23 | Intake | "and messages" | contract | No patient messaging. |
| 24 | Documentation | "PT, OT and speech templates for evaluations, daily notes, progress and discharge" | contract | One plain-text note box. |
| 25 | Documentation | "The scribe drafts from the visit" | contract | No scribe or AI drafting. |
| 26 | Documentation | "you review and sign" | partly | Practitioners write and amend their own notes (row 3); no signature. |
| 27 | Documentation card | Billed CPT units, "8-minute rule · 3 units" | contract | No CPT codes or unit calculation. |
| 28 | Insurance billing | "Check eligibility" | contract | — |
| 29 | Insurance billing | "track authorizations" | contract | — |
| 30 | Insurance billing | "send claims through Claim.MD or Availity" | contract | No clearinghouse connection. |
| 31 | Insurance billing | "Payments post from the ERA" | contract | — |
| 32 | Insurance billing | "denials arrive with the fix" | contract | — |
| 33 | Interlude | "All 14 notes signed · claims sent" | contract | Notes exist (row 3); claims do not. |
| 34 | Patient payments | "Cards on file" | code | The patient saves a card from their private link after ticking the clinic's authorization (exact text and time kept): Stripe Checkout in setup mode, a SetupIntent for off-session charges; Balm keeps brand, last four and expiry, Stripe keeps the card (`src/balm/payments/cards.ts`, `src/balm/ui/pay.ts`). Each install connects its own Stripe key in Clinic → Online payments (`src/balm/payments/connect.ts`). Not on RER Managed until RER adds an egress relay: it says so in one line. |
| 35 | Patient payments | "text-to-pay links" | partly | Pay links for any balance go **by email** now (`pay.link.create`, `src/balm/payments/links.ts`, `src/balm/payments/notify.ts`); the patient pays any amount up to the balance in Stripe Checkout. **Texting** the link is built behind the SMS adapter (`src/balm/sms/`, Twilio; recorded-response fixture in `tests/fixtures/twilio-message.json`) and sends nothing until the clinic's US A2P 10DLC registration is approved and its Twilio settings are deployed; the file says so in one line. |
| 36 | Patient payments | "superbills" | code | A superbill PDF per visit (approved invoice) with the clinic's tax ID and address, the rendering practitioner and NPI (check digit validated), the patient, the date of service, ICD-10 diagnoses with pointers, CPT codes with modifiers and units, charges, paid and balance; refused, naming what is missing, until all are present (`src/balm/payments/documents.ts`, `src/balm/payments/codes.ts`). CPT comes from the visit's codes; when signed notes froze billed units on the invoice (`procedures`), those are used. Downloadable by the desk and from the patient's link. |
| 37 | Patient payments | "clear statements" | code | A statement across visits: every approved invoice, desk payment and card payment in order with a running balance and the balance due (or credit), on the patient's link and as a PDF (`ledger` in `src/balm/payments/ledger.ts`, `statementPdf` in `src/balm/payments/documents.ts`), and in the client file. |
| 38 | Patient payments | "Copays collect at check-in" | code | The day view shows **Check in and charge $30.00 copay to Visa ending 4242** for today's visits of a patient with a copay and a card on file: one action checks in and charges the card off session; a declined card or a bank's confirmation request is shown and the visit stays checked in. A receipt (R-000001) is numbered, kept as a PDF and emailed; the copay waits on the visit until its invoice is approved, then counts toward it (`src/balm/payments/index.ts` `checkIn`, `src/balm/ui/payments.ts` `checkInActions`). |
| 39 | Reminders | "Text and email reminders go out on their own" | partly | As row 4: email-ready text a person approves and sends; no automatic sending, no SMS. |
| 40 | Reminders | "Patients confirm or ask for a new time in one reply" | contract | No inbound replies. |
| 41 | The case agent | "follows each referral from authorization to paid claim" | contract | An owner-made agent key can read names, appointments and invoices and prepare invoices, reminders and intake versions for approval (`src/balm/credentials.ts`, `docs/AGENT-COMMANDS.md`); no referrals, authorizations or claims to follow. |
| 42 | The case agent | "spots what stalled, cites the record and lines up the next step" / "Send to payer" | contract | — |
| 43 | Moving in | "Import patients … from … Cliniko" | partly | Cliniko patient CSV (six columns) with preview, apply, journal and undo: `src/balm/movein/`, `src/balm/ui/import.ts`, `docs/MOVE-IN.md`. Synthetic fixture only; no real export tried. |
| 44 | Moving in | "appointments, notes and balances" | contract | Only client details move. |
| 45 | Moving in | "from WebPT, SimplePractice, Jane" | contract | Cliniko only. |
| 46 | Moving in | "check every total before you switch" | partly | The preview lists every row, diagnostics and conflicts before anything is written (`src/balm/movein/index.ts`); no totals to reconcile because balances do not move. |
| 47 | Ownership | "Run Balm on your own computer" (the five commands) | code | `rer install`, `rer setup`, `rer dev` via `@runeditrun/rer` 0.2.37 (`package.json`, `OPERATIONS.json`, `README.md`). |
| 48 | Ownership | "keep every chart" / "Your charts, your database" | code | The local D1 database in the checkout (`wrangler.jsonc`, `.wrangler/state`). |
| 49 | Ownership | "Export everything, any time" | code | `rer export` / `rer import` with the archive policy `src/balm/archive-policy.mjs` (tested in `tests/archive.test.mjs`). |
| 50 | Quiet details | Telehealth: "Video visits from the same calendar" | contract | `seed.json` lists telehealth as a non-goal of the first release. |
| 51 | Quiet details | Home exercise programs | contract | — |
| 52 | Quiet details | Secure messaging | contract | — |
| 53 | Quiet details | Therapy cap tracking: "KX threshold flagged" | contract | — |
| 54 | Quiet details | Plan of care signatures | contract | — |
| 55 | Quiet details | Audit log: "Every chart view and change, recorded" | code | `bm_audit` rows for every file view, intake and note read, change and download, append-only by trigger (`migrations/core/0015_balm.sql:115-116`; `src/balm/domain/clients.ts`, `notes.ts`, `invoices.ts`). |
| 56 | Closing | "Open source practice management for US therapy clinics" | partly | Open source practice management: yes (rows 1-4, 6). US: this round made the visible strings US (en-US dates, USD, tax ID, US time-zone examples); the default time zone, Cliniko-style move-in dates and insurance billing are not yet US. |
| 57 | Closing | "Free and open source, MIT licensed" | code | `LICENSE`. |

## Summary

57 claims: **18 code**, **12 partly**, **27 contract, not yet in code** (rows 1, 15, 16 and 18 updated by the schedule round; rows 6, 34, 35, 36, 37 and 38 by the payments round, 17 Oct). Counting the partly rows, whose claimed form is not built, 39 of 57 go beyond today's code. The largest gaps are the whole of insurance billing (eligibility, authorizations, claims, ERA, denials, KX), discipline templates, the scribe and signatures, sent and answered reminders, text messages (waitlist offers and pay links wait on the clinic's US A2P registration), the patient portal (insurance card, home exercises, messaging), telehealth, the case agent, and move-in beyond Cliniko patients. Card payments (rows 6, 34 and 38, and paying from a link in 35) run on self-hosted installs; RER Managed shows them as not available yet until RER adds an egress relay. Statements and superbills (rows 36, 37) work everywhere.

"Try the demo" links `/run`: Balm has no hosted demo (no `deploy-demo.json` or `DEMO.md`; `demo.run-balm.com` has no DNS record on 17 Oct 2026), so it opens the page that starts Balm on your own computer.
