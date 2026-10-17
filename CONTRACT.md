# Balm contract

Target edition: 17 October 2026. Balm is the practice management system and EHR a US outpatient physical, occupational or speech therapy practice buys instead of WebPT, SimplePractice, Jane or Cliniko, with the rehab-specific billing and AI depth buyers now look for in SPRY, Prompt Health and splose. It runs the whole clinic: scheduling, intake and the patient portal, discipline-specific documentation, reminders and two-way messaging, and cash-pay and insurance billing through to money in the bank. Prices, fees and balances are in USD; dates, phone numbers, time zones, tax IDs and payer rules follow US practice.

This is a target contract, not a release verdict. It describes the product Balm is being built towards, and the [Status](#status) section marks how close the current code is. Every named clause states the behaviour a buyer gets and the acceptance evidence that proves it through a public door. Difficulty (clearinghouse enrolment, payer rules, HIPAA business associate agreements, native apps, card payments) is engineering work recorded as a clause, never a reason to narrow the product. The first-release guarantees, which the earlier contract carried under `BALM-001` and its paragraphs, are kept below with their behaviour unchanged; this documentation round changes no homepage, interface or runtime behaviour.

## Product target

| | |
| --- | --- |
| Category | Practice management and EHR for therapy / allied-health clinics |
| Incumbents a buyer switches from | WebPT, SimplePractice, Jane, Cliniko, SPRY, Prompt Health, splose |
| First buyer | The owner of a US outpatient physical, occupational or speech therapy practice with 1 to 10 clinicians, billing Medicare, commercial payers and cash-pay patients in USD |

WebPT, SimplePractice, Jane and Cliniko are the incumbents; SPRY, Prompt Health and splose are the up-and-comers Balm must also beat. A practice switches when every daily job has a Balm equivalent, its records arrive with balances that reconcile, and its payers, card processor, books and phones plug in:

- **Schedule.** Practitioner, room and equipment calendars, recurring visits that follow the plan of care, waitlists that fill cancellations by text, patient self-booking and rescheduling, and attendance history (`SCHED-*`).
- **Welcome the patient.** Intake packets, signed consents and insurance cards collected before the first visit, and a portal for appointments, home exercises, messages, statements and payments (`INTAKE-*`, `PORTAL-*`).
- **Document.** PT, OT and SLP evaluations, daily notes, progress reports, re-evaluations and discharge summaries; plans of care certified by the referring physician; objective measures and outcome scores; sign, lock, amend and co-sign; an ambient scribe that drafts for the clinician to sign (`CHART-*`).
- **Coordinate care.** Referrals and referring providers, faxes in and out, and direct-access limits (`REF-*`).
- **Stay in touch.** Delivered email and two-way SMS reminders, confirmations, follow-ups and recalls, recorded on the patient's file (`COMM-*`, `REMIND-001`), and video visits from the same calendar (`TELE-001`).
- **Get paid by patients.** Cards on file through Stripe, copays at check-in, text-to-pay links, statements, superbills, Good Faith Estimates, packages and payment plans (`BILL-001`, `PAY-*`).
- **Get paid by payers.** Payers and fee schedules, eligibility, authorizations, clean claims through Claim.MD or Availity, ERA posting, denials and A/R follow-up, and Medicare's 8-minute rule, KX threshold, ABN and assistant modifiers (`INS-*`).
- **Run the business.** Daily close, operational, financial and outcome reports, and QuickBooks Online or Xero handoff (`REPORT-*`, `ACCT-001`).
- **Stay safe.** Live roles, two-step sign-in, an append-only access audit, HIPAA deployment readiness, retention, disclosure accounting, backups, erasure and complete export (`BALM-001`, `SEC-*`, `AUDIT-001`, `HIPAA-*`, `ERASE-001`, `PORT-001`).
- **Move in.** Real WebPT, Jane, SimplePractice and Cliniko migrations with reconciled patients, appointments, documents, balances and open authorizations (`MOVE-*`).
- **Anywhere.** A tablet-first clinician web app and native iOS and Android apps for clinicians and patients (`MOBILE-*`), a public API, webhooks and FHIR export (`INTEG-*`).
- **Push further.** A case agent that follows each referral from authorization to paid claim, plus agents for scheduling continuity, documentation defensibility, denials, month-end reconciliation, outcomes, the front-desk inbox and migration, each under human control (`AGENT-*`).

### Neighbouring products stay separate

Balm is one product. Where the market sells a neighbouring product separately, Balm connects to it and does not rebuild it; when the neighbour is a Run Edit Run sibling, Balm links to that sibling first and to the US incumbent second.

| Job | Owned by | How Balm meets it |
| --- | --- | --- |
| Bookkeeping, bank feeds and tax filing | [Pantry](https://github.com/just-every/run-pantry) (or QuickBooks Online, Xero) | Charges, payments, refunds, fees and deposits handed off to the books (`ACCT-001`) |
| Appointment booking for non-clinical businesses | [Dial](https://github.com/just-every/run-dial) | Balm keeps its own clinical scheduler, which shares Dial's availability engine code but not its product (`SCHED-*`) |
| Staff HR records, onboarding and benefits | [Willow](https://github.com/just-every/run-willow) (or BambooHR, Gusto) | Balm keeps only the clinician licence, NPI, taxonomy and payer enrolment facts billing needs (`INS-001`) |
| Staff shift scheduling and time clocks | [Lanyard](https://github.com/just-every/run-lanyard) (or Homebase) | Practitioner treatment hours stay in Balm (`SETUP-001`) |
| Payroll and 1099/W-2 filing | No seed (Gusto, ADP RUN) | Visit and productivity exports for per-visit pay (`REPORT-001`) |
| Marketing email campaigns | [Mango](https://github.com/just-every/run-mango) (or Mailchimp) | Opt-in, non-clinical contact sync only (`INTEG-002`) |
| Contracts and general e-signature | [Inkwell](https://github.com/just-every/run-inkwell) (or DocuSign) | Clinical signatures, consents and plan-of-care certification stay in Balm (`INTAKE-003`, `CHART-003`, `CHART-004`) |
| General forms and surveys | [Pencil](https://github.com/just-every/run-pencil) (or Typeform) | Intake forms and outcome questionnaires stay in Balm (`INTAKE-002`) |
| Cash-pay studio memberships and classes | [Strap](https://github.com/just-every/run-strap) (or Mindbody) | Clinical packages and wellness plans stay in Balm (`PAY-008`) |
| Clinic website | [Pane](https://github.com/just-every/run-pane) (or Squarespace) | An embeddable booking page (`SCHED-006`) |
| Staff sign-in through a company identity provider | [Auth](https://github.com/just-every/run-auth) (or Okta, Google Workspace) | Optional OIDC/SAML sign-in for staff (`SEC-001`) |
| Security compliance programmes (SOC 2) | [Evidence](https://github.com/just-every/run-evidence) (or Vanta) | Balm exposes its access audit and BAA register for Evidence to read (`HIPAA-001`, `AUDIT-001`) |
| Business phone system and call recording | No seed (RingCentral, Dialpad) | Balm sends and receives SMS and logs calls a person records; it is not a phone system (`COMM-002`, `COMM-003`) |

### How to read this contract

- **Published clauses** are the behaviour the first-release contract already promised: `BALM-001` keeps its ID, and the guarantees that contract stated in its paragraphs and in `ACCEPTANCE.md` are named here (`SETUP-001`, `SCHED-001`, `INTAKE-001`, `CHART-001`, `BILL-001`, `PAY-001`, `REMIND-001`, `AUDIT-001`, `ERASE-001`, `PORT-001`, `MOVE-001`). Public-door integration coverage is in `tests/balm.test.mjs`; CLI archive coverage is in `tests/archive.test.mjs`.
- **Target clauses** are binding product requirements not yet promised by a release. A build round that starts one registers it in `seed.json → capabilities` in the same change. IDs never change.
- **Push-further clauses** (`AGENT-*`) are agent work beyond today's up-and-comers. Every agent acts through `BALM-001`'s prepare-and-approve fence: it reads only what its key's scope allows, prepares, and a named person approves; clinicians confirm every clinical assertion and people decide every financial exception.
- **Status** is `done`, `partial` or `missing`, judged in the [Status](#status) section from the code and tests at the commit it names. `done` means the behaviour ships and a cited test exercises it; `partial` means some of it ships; `missing` means there is no implementation. Status is a build-planning judgement, not acceptance; [ACCEPTANCE.md](ACCEPTANCE.md) lists each clause's acceptance evidence.

## Scope coverage

The owner-approved scope (16 October 2026) names what Balm was missing against the category. Each item is covered by these clauses:

| Scope item | Clauses |
| --- | --- |
| US insurance billing: eligibility, authorization and visit tracking, CPT/ICD-10 coding, 837 claims through a clearinghouse (Claim.MD, Availity), ERA/remittance and denial management, Medicare 8-minute rule and therapy-cap/KX tracking | `INS-001` to `INS-011`, `CHART-006`, `CHART-007` |
| Card-on-file and payment links via Stripe, superbills and patient statements | `PAY-002` to `PAY-007` |
| Recurring appointments, waitlists, patient self-booking and delivered two-way SMS/email reminders | `SCHED-003`, `SCHED-005`, `SCHED-006`, `COMM-001`, `COMM-002`, `COMM-004` |
| Patient portal with intake, consent, home-exercise programs and secure messaging | `PORTAL-001` to `PORTAL-006`, `INTAKE-002` to `INTAKE-004` |
| PT/OT/SLP documentation templates (initial eval, daily notes, progress and discharge, plan of care with physician signature) and AI scribe | `CHART-002` to `CHART-013` |
| HIPAA readiness (BAA-backed hosting, audit, retention) plus telehealth and real Jane/WebPT/Cliniko migration | `HIPAA-001` to `HIPAA-004`, `AUDIT-001`, `TELE-001`, `MOVE-002` to `MOVE-006` |
| Push further: a case agent that follows each referral through authorization, documented visits and paid claims | `AGENT-001`, with `AGENT-002` to `AGENT-008` |

## Clinic setup, roles and security

- **BALM-001 — Live roles and server-side authority.** Every `/app` page and `/api/balm` handler resolves the live actor from a native session (or, at `/api/balm/agent/*`, an owner-bound agent key) and enforces its role in the handler; every write re-checks that authority inside the same D1 batch. Roles: the owner; practitioners, who see only clients they are booked with; reception, who see every file but never intake answers or treatment notes; and agent keys, which only prepare work for a person. A person approves every preparation, and the approval keeps the SHA-256 of the exact approved content. Deactivating staff or revoking a key takes effect on the next request. **Acceptance evidence:** Call every page and handler signed out, as each role, with a deactivated staff member and with a revoked or foreign agent key; each is refused or scoped by role, and an agent-prepared item is approved only by a signed-in person whose approval records the digest.

- **SETUP-001 — Clinic, services, practitioners and hours.** The owner sets the clinic name, address, tax ID and time zone, services with length and price, practitioners with their discipline and weekly hours, and invites practitioners and reception by email; a first-run checklist shows what is left. The time zone is fixed once the first visit is booked. **Acceptance evidence:** From a fresh install, complete the checklist through the app, invite a practitioner and a receptionist, and see the public booking page offer only the practitioner's hours.

- **ROLE-002 — Billing, assistant, student and supervisor roles.** Beyond owner, practitioner and reception, the practice assigns biller (claims, payments and A/R, no note text beyond what a claim needs), PTA/COTA/SLPA assistants (document under a supervising therapist), students and clinical fellows (draft only, co-signature required), and location managers (one location's schedule and reports). Each permission is enforced server-side as `BALM-001` does today. **Acceptance evidence:** Sign in as each new role and attempt every read and write in the access matrix; allowed actions succeed, others are refused with no write, and each refusal is audited.

- **SEC-001 — Two-step sign-in and session control.** Staff sign in with an email link plus a second step (passkey or authenticator code), required for every role that can read PHI; an owner can require it clinic-wide, sees active sessions and devices, signs any of them out, and sets an idle timeout (default 15 minutes on shared workstations). Optional OIDC or SAML sign-in through the practice's identity provider (Auth, Google Workspace, Okta) maps to Balm roles without widening them. **Acceptance evidence:** Enforce two-step sign-in, sign in with and without the second step, let a session idle past the timeout, and sign out a device remotely; the next request from each refused session is denied.

- **SEC-002 — Public doors that refuse abuse.** `/book`, `/intake/<token>`, portal sign-in and payment links check request origin, rate-limit by address and by patient email, cap pending online bookings per email, never echo clinical answers, and treat every link token as a one-use or expiring bearer credential stored only as a hash. **Acceptance evidence:** Post to each public door cross-origin, replay a used intake link, exceed the booking cap and the rate limit, and inspect storage; each is refused and no raw token is stored.

- **US-001 — US clinic defaults.** A new clinic starts in USD with en-US dates, a US time zone chosen at setup, +1 phone numbers, US states and ZIP codes, an EIN or SSN tax ID with the practice NPI, and US imports reading MM/DD/YYYY dates. **Acceptance evidence:** Set up a clinic in America/Chicago, book, invoice and import a patient file with US dates; every screen, file and message shows USD, en-US dates, +1 numbers and the practice's EIN and NPI.

- **OWN-001 — Owned, open-source and free.** Balm is MIT licensed and charges nothing. The practice runs it on its own computer (`rer install`, `rer setup`, `rer dev`) or its own Cloudflare account, its database is its own, and no licence check, telemetry or kill switch exists. **Acceptance evidence:** Install from a clean checkout with the documented commands, run the clinic loop, and observe no outbound request other than the declared integrations the owner enabled.

## Scheduling

- **SCHED-001 — Online booking from real open times.** New patients book at `/book` from a practitioner's real open times in 15-minute steps, at least 2 hours and at most 60 days ahead, get the intake link by email, and a taken or invalid slot is refused in the same D1 batch that inserts the appointment, even when two people race for it. **Acceptance evidence:** Book online for a new patient, see the slot disappear and the intake email sent, book a taken or off-grid slot and be refused, and race two bookings for one slot and see exactly one succeed.

- **SCHED-002 — Practitioner, room and equipment calendar.** Staff work from a day and week calendar across practitioners, treatment rooms, gyms and equipment (for example a pool or an AlterG), drag to move a visit, see intake, authorization and balance flags on each visit, and print or export the day sheet. A visit can require a room or equipment and is refused when it is taken. **Acceptance evidence:** Book two practitioners into one room at the same time and see the second refused; move a visit by drag and see its history; read the week view for three practitioners with each visit's flags.

- **SCHED-003 — Recurring visit series.** A practitioner books a series (for example twice weekly for 6 weeks) from the plan of care's frequency and duration; Balm names every conflict before booking, books the rest, and lets staff edit or cancel one visit, this and following, or the whole series. **Acceptance evidence:** Book a 12-visit series that collides with a holiday and an existing visit; see the conflicts named, resolve them, and cancel "this and following" from visit 8 with earlier visits untouched.

- **SCHED-004 — Reschedule, cancel and no-show policy.** Staff and patients reschedule a visit without losing its history, intake or authorization link; cancellations record who and why; the clinic sets a late-cancel window and a late-cancel or no-show fee that is charged to the card on file only after a person confirms. **Acceptance evidence:** Reschedule a visit and see one appointment with its history; cancel inside the late window and see the fee proposed, approved and charged once; mark a no-show and see it in attendance reports.

- **SCHED-005 — Waitlist that fills openings.** Patients join a waitlist with practitioner, days, times and earliest date; when a visit is cancelled, Balm offers the opening by text and email to matching patients in order, holds it for a set time, books the first patient who accepts and tells the others it is gone. **Acceptance evidence:** Put three patients on the waitlist, cancel a matching visit, accept from the second patient's text reply after the first lets the hold lapse, and see one booking and a "slot taken" message to the third.

- **SCHED-006 — Patient self-service scheduling.** Existing patients book, reschedule and cancel follow-up visits from the portal, a reminder reply or `/book` (where an exact name, birth date and email match continues their file) within clinic rules: which services they may self-book, notice, and whether an active plan of care or authorization is required. The booking page embeds on the clinic's website. **Acceptance evidence:** As a returning patient, book at `/book` and land in the same file; as a portal patient, book a follow-up, reschedule it inside the rules, and be refused outside notice or past the authorized visit count; book through the page embedded on a test website.

- **SCHED-007 — Service types, locations and availability rules.** Services carry their own length, price, CPT defaults and bookable practitioners (an evaluation at 60 minutes, a follow-up at 45); a practice runs several locations with their own hours, rooms and time zone; holidays, time off and one-day overrides change availability; buffers separate visits. **Acceptance evidence:** Create two locations, an evaluation and a follow-up service and a day off; online booking offers each service only where and when its rules allow.

- **SCHED-008 — Check-in, attendance and change history.** Each visit moves through booked, checked in, attended, no-show or cancelled, and every change is recorded with who and when. Marking a visit attended starts its note and its charge. **Acceptance evidence:** Book, check in and mark attended, then mark another visit no-show and another cancelled; each visit's history lists every change and its actor.

- **SCHED-009 — Calendar subscription.** Each practitioner subscribes their own schedule in Google Calendar, Outlook or Apple Calendar through a private, revocable iCalendar feed carrying times and initials only, never a diagnosis or full name. **Acceptance evidence:** Subscribe to the feed, book and cancel a visit, see the feed follow; revoke the feed and see the old address refused.

## Intake and patient portal

- **INTAKE-001 — One-use intake bound to its form version.** Every booking creates a private intake link, emailed to the patient through the clinic's mail; it accepts answers once, binds them to the exact form version answered, never echoes clinical answers back, and lets only the treating practitioner and the owner read them. **Acceptance evidence:** Book online, open the emailed link, submit the intake, replay the link and be refused; read the answers as the treating practitioner and be refused as reception and as another practitioner.

- **INTAKE-002 — Intake packets and outcome questionnaires.** The practice builds versioned forms and packets per service and discipline (PT, OT, SLP, pediatric), including standard outcome questionnaires (LEFS, Oswestry, Neck Disability Index, QuickDASH, PSFS) scored automatically into the chart. A new version never changes past answers. **Acceptance evidence:** Publish a PT packet with the LEFS, answer it as a patient, see the score in the chart, publish a new version and see earlier answers still bound to the old one.

- **INTAKE-003 — Signed consents and policies.** Patients sign consent to treat, the HIPAA Notice of Privacy Practices acknowledgement, the financial and cancellation policy, telehealth consent and SMS consent, each with a drawn or typed signature, the time, the signer (patient, parent or guardian) and the exact document version, stored as a fixed PDF in the chart. **Acceptance evidence:** Sign each consent as a parent for a minor, download the fixed PDF, change the policy and see the patient asked to re-sign the new version only.

- **INTAKE-004 — Insurance and identity capture.** Before the first visit the patient adds primary and secondary insurance (payer, member ID, group, subscriber and relationship) and photos of the card front and back and a photo ID; Balm validates required claim fields and starts an eligibility check (`INS-002`). **Acceptance evidence:** Complete intake with two policies and card photos; see the policies on the file, missing subscriber fields refused, and an eligibility request created.

- **PORTAL-001 — Patient portal.** Patients sign in by email link or SMS code to see upcoming and past visits, forms to complete, their home program, messages, statements, receipts and superbills, and to update contact, insurance and card details. A parent or guardian manages a minor's portal. **Acceptance evidence:** Sign in as a patient and as a guardian of two children, see only their own records, complete a form, and update insurance with the change audited.

- **PORTAL-002 — Home exercise programs.** Clinicians build a home program from an exercise library (images, video, sets, reps, frequency) or their own exercises, assign it from the note, and patients follow it in the portal or as a printable PDF and log completion and pain; adherence shows in the chart. **Acceptance evidence:** Assign a 5-exercise program from a daily note, open it as the patient, log three sessions, and see adherence in the next note.

- **PORTAL-003 — Secure messaging.** Patients and the clinic exchange secure messages and attachments in the portal; notification texts and emails carry no clinical content; messages route to the practitioner or front desk, are kept on the patient's file, and an auto-reply tells patients the inbox is not for emergencies and to call 911. **Acceptance evidence:** Send a message with a photo as a patient, see an alert with no clinical text, reply as the practitioner, and find the thread in the file and the audit.

- **PORTAL-004 — Statements, receipts and superbills in the portal.** Patients see their balance, every statement, receipt and superbill, and pay from the portal (`PAY-003`). **Acceptance evidence:** After a paid visit and an unpaid one, open the portal and download the receipt and superbill, then pay the balance and see it at zero.

- **PORTAL-005 — Accessible, English and Spanish patient pages.** Booking, intake, consents, the portal, reminders and statements meet WCAG 2.2 AA and are offered in English and Spanish, chosen by the patient and remembered on the file. **Acceptance evidence:** Complete booking and intake in Spanish with a screen reader and keyboard only; an automated and manual WCAG 2.2 AA review of each patient page passes.

- **PORTAL-006 — Patient access to their record.** A patient requests their record from the portal; the practice fulfils it within the HIPAA 30-day limit as a readable PDF and a machine-readable export (FHIR R4 US Core, `INTEG-001`), and the request, its due date and the delivery are tracked. **Acceptance evidence:** Request the record as a patient, see the due date on the staff work queue, release it, and download both formats from the portal.

## Clinical documentation

- **CHART-001 — Private revisioned treatment notes.** Treatment notes are readable only by their author and the owner (and, under `CHART-013`, the care team the practice grants), and amendments add revisions that keep every earlier text. **Acceptance evidence:** Write and amend a note as a practitioner; read every revision as the author and the owner, and be refused as reception and another practitioner.

- **CHART-002 — PT, OT and SLP templates.** Discipline templates cover the initial evaluation, daily note (SOAP), progress report, re-evaluation and discharge summary for physical, occupational and speech therapy, with body-region and diagnosis variants, pick lists, defaults carried forward from the last visit, and practice-customised versions that never change signed notes. **Acceptance evidence:** Document an OT evaluation, three daily notes, a progress report and a discharge in the OT templates; each carries forward what it should, and a template change leaves signed notes unchanged.

- **CHART-003 — Plan of care and physician certification.** The evaluation produces a plan of care with ICD-10 diagnoses, short- and long-term goals, frequency, duration and interventions; Balm sends it to the referring physician or non-physician practitioner by fax or link for e-signature, records the certification date, and tracks the 90-day recertification and any state direct-access limit. **Acceptance evidence:** Sign an evaluation, send its plan of care, sign it as the physician through the link, and see the certification date and recertification due date on the case; let it lapse and see visits flagged.

- **CHART-004 — Draft, sign, lock and amend.** Notes are drafts until the clinician signs; signing locks the note with the signer, time and credentials; changes after signing are addenda or amendments that keep the signed original visible; unsigned notes past the practice's deadline appear on the daily close. **Acceptance evidence:** Sign a note, try to edit it and be offered an addendum, add one, and read both the original and the addendum; an unsigned note past 24 hours appears on the daily close.

- **CHART-005 — Objective measures and flowsheets.** Clinicians record range of motion, manual muscle tests, girth, balance and gait tests, standardised scores and exercise flowsheets in structured fields, compare them with the evaluation and graph them over the episode. **Acceptance evidence:** Record knee flexion and LEFS at evaluation and three later visits; the progress report shows the change and the graph matches the entries.

- **CHART-006 — Billing captured from the note.** The note records each CPT code with timed and untimed minutes; Balm calculates billable units by the Medicare 8-minute rule or the payer's own rule, applies GP, GO or GN, 59 or X{EPSU}, KX, CQ or CO modifiers where they apply, links ICD-10 pointers, and sends the signed charge to billing. **Acceptance evidence:** Document 38 minutes across 97110 and 97140 and one untimed 97161 for a Medicare patient; the charge shows 3 timed units distributed by the rule, the right modifiers and diagnosis pointers.

- **CHART-007 — Documentation compliance alerts.** Before signing, Balm warns when a progress report is due (Medicare: by the 10th treatment day), the plan of care is uncertified or expired, the KX threshold is near, an assistant's visit needs supervision, or a required element for the payer is missing. **Acceptance evidence:** Reach the 10th visit without a progress report, an expired certification and a KX-threshold patient; each warning appears before signing and on the daily close.

- **CHART-008 — Supervision and co-signature.** Students, clinical fellows and assistants document under a named supervisor; their notes wait in the supervisor's co-sign queue, are billed under the supervisor where payer rules require, and show both signatures. **Acceptance evidence:** Document as a student, co-sign as the supervisor, and see the note locked with both signatures and the claim under the supervisor.

- **CHART-009 — Attachments and searchable history.** Referrals, imaging reports, physician orders and photos attach to the chart; clinicians search the patient's history by text, date, document type and episode. **Acceptance evidence:** Attach a faxed MRI report and two photos, search the chart for "MRI", and open the result; reception without clinical rights is refused.

- **CHART-010 — Alerts and precautions.** Medical alerts, precautions and important notes (falls risk, weight-bearing limits, latex allergy) show on the chart header, the calendar and check-in. **Acceptance evidence:** Add a weight-bearing precaution and see it on the calendar visit, check-in and the next note.

- **CHART-011 — Clinical letters and exports.** Clinicians send progress letters, plan-of-care summaries and discharge summaries to referring providers, payers and patients by fax, secure link or print, from templates filled from the chart, with each send recorded. **Acceptance evidence:** Send a progress letter to the referring physician by fax and to the patient by portal; both sends appear on the file with their content fixed.

- **CHART-012 — Ambient scribe.** With the patient's recorded consent, the clinician records the visit on a phone or tablet and Balm drafts the note sections, objective measures and billed minutes into the discipline template; the clinician edits and signs, and nothing is signed or billed from a draft. Audio is deleted after the draft unless the practice chooses to keep it, and the scribe model runs only under the deployment's BAA. Notes drafted in a connected scribe (for example Heidi) import as drafts the same way. **Acceptance evidence:** Record a consented visit, review the draft, change one statement and sign; the signed note shows the clinician as author, the audio is gone, and a visit without consent offers no recording.

- **CHART-013 — Care team access with audited emergency access.** The practice grants co-treating and covering clinicians access to a patient's notes; any clinician can open a chart outside their grant only by giving a reason ("break glass"), which notifies the owner and is audited. **Acceptance evidence:** Grant a covering clinician access, read as them, revoke and be refused; break glass as another clinician and see the owner's notice and the audit row.

## Referrals and care coordination

- **REF-001 — Referrals and referring providers.** Each episode starts from a referral or direct-access entry with its source, referring provider (looked up by NPI from the NPPES registry), diagnosis, order and documents; staff track each referral from received to scheduled, evaluated, discharged or lost, and see conversion by source. **Acceptance evidence:** Enter three referrals with NPI lookup, schedule two and mark one lost; the referral report shows conversion by provider and source.

- **REF-002 — Fax in and out.** Balm receives faxes on the practice's number through a HIPAA-eligible fax provider under a BAA, files each one to a patient and referral after a person confirms the match, and sends plans of care, letters and records by fax with delivery confirmation. **Acceptance evidence:** Receive a referral fax, file it to a new referral, send a plan of care by fax and see the confirmation on the file.

- **REF-003 — Episodes of care.** A patient can have several episodes (left knee, then low back), each with its own referral, plan of care, authorization, outcome scores, visits and discharge, so billing, limits and reports count by episode. **Acceptance evidence:** Open two episodes for one patient, document in both, and see visit counts, authorization use and outcomes kept apart.

## Reminders and patient communication

- **REMIND-001 — Reminder content a person approves.** Reminder text is prepared from the appointment (by staff or an agent key), a person approves the exact text, and the approval keeps its digest; the approved text can be exported unchanged. Delivery is `COMM-001` and `COMM-002`. **Acceptance evidence:** Prepare a reminder with an agent key, approve it as a person, and export the exact approved text with the approval digest recorded.

- **COMM-001 — Delivered email confirmations and reminders.** Balm sends booking confirmations, intake links, reminders (for example 48 and 24 hours before) and changes by email through the clinic's mail provider, records each delivery state, and keeps clinical detail out of the message. **Acceptance evidence:** Book a visit and see the confirmation and intake email delivered; advance the clock and see the reminders sent once each with delivery recorded; a failed delivery shows on the file.

- **COMM-002 — Two-way text messages.** Balm sends reminders and confirmations by SMS through Twilio (or the clinic's own Twilio account) from a registered 10DLC number, only to patients who consented, honours STOP and HELP, respects quiet hours in the patient's time zone, and reads replies: C confirms, R asks for a new time, anything else goes to the front-desk inbox. **Acceptance evidence:** Send a reminder by SMS, reply C and see the visit confirmed, reply R and see a reschedule request, reply STOP and see no further texts; a patient without consent gets none.

- **COMM-003 — Communication history on the file.** Every email, text, portal message, fax and logged call, sent or received, with delivery state, is kept on the patient's file and searchable by staff with access. **Acceptance evidence:** Exchange an email, a text, a portal message and a fax with one patient and log a call; the file lists all five with their states.

- **COMM-004 — Follow-ups and recalls.** The clinic configures sequences: post-evaluation welcome, missed-visit outreach, "no next visit booked" while a plan of care is open, discharge survey and review request, and recall at a set interval; each stops when its goal is met, respects consent and contact limits, and shows on the file. **Acceptance evidence:** Leave a patient with an open plan of care and no next visit, see the outreach sent, book a visit and see the sequence stop.

## Telehealth

- **TELE-001 — Video visits from the calendar.** A visit can be a video visit: the patient joins from the reminder or portal without an account, the clinician from the calendar, through built-in video or a connected provider that signs a BAA (for example Zoom for Healthcare); the visit records the consent, location and start and end times, and the claim carries the telehealth place of service and modifier the payer requires. **Acceptance evidence:** Book a video visit, join as patient and clinician, document and sign; the claim shows POS 10 and modifier 95 for a commercial payer that requires them.

## Patient billing and payments

- **BILL-001 — Approved, numbered invoices with fixed bytes.** An invoice is prepared from an attended visit, a person approves it, and only then is it numbered and its downloadable bytes fixed; approval is refused if any frozen fact changed; voiding keeps the number. **Acceptance evidence:** Prepare, change the visit, see approval refused, re-prepare and approve; download the invoice twice and get identical bytes.

- **PAY-001 — Payments recorded once per reference.** Payments received outside Balm are recorded with a unique external reference, never above the invoice, and leave the outstanding balance. **Acceptance evidence:** Record a check payment, record the same reference again and be refused, and try to exceed the invoice and be refused.

- **PAY-002 — Cards on file and payments at check-in.** Through the clinic's Stripe account, patients save a card or HSA/FSA card from intake or the portal and staff charge copays, coinsurance and balances at check-in, by saved card or Stripe Terminal, with Balm never holding card numbers; refunds need a person's approval. **Acceptance evidence:** Save a card in intake, charge a $30 copay at check-in, refund it with approval, and see the Stripe charge and refund mirrored on the patient's ledger.

- **PAY-003 — Payment links and online prepayment.** Staff text or email a payment link for a balance; cash-pay services can require a deposit or full prepayment at online booking; paid links post to the ledger automatically and expire. **Acceptance evidence:** Text a link for a $120 balance, pay it, and see the balance at zero; book a prepaid service online and see the payment on the visit.

- **PAY-004 — Statements, receipts, adjustments and refunds.** Each patient has a ledger across visits; Balm produces receipts and periodic statements, records adjustments, write-offs and credits with a reason and approver, and applies credits to later visits. **Acceptance evidence:** Bill three visits, pay one, write off part of another with approval, and send a statement that matches the ledger.

- **PAY-005 — Superbills.** For out-of-network patients Balm produces a superbill per visit or period with the practice and rendering NPIs, tax ID, CPT codes and units, ICD-10 codes, fees and payments. **Acceptance evidence:** Produce a superbill for a month of visits and check every required field against the signed notes and ledger.

- **PAY-006 — Payment plans and balance reminders.** Staff set up payment plans charged automatically to the card on file, and Balm sends balance reminders on a schedule until paid or a person stops them; accounts past a set age go to a human review list, never automatically to collections. **Acceptance evidence:** Create a 3-month plan and see each charge post; leave a balance unpaid and see the reminder sequence and the review-list entry.

- **PAY-007 — Good Faith Estimates.** For uninsured and self-pay patients Balm produces a No Surprises Act Good Faith Estimate from the plan of care and fee schedule within the required timelines, keeps it on the file, and flags billed totals that exceed it by $400 or more. **Acceptance evidence:** Book a self-pay evaluation, see the estimate issued and kept, bill above it by $400 and see the flag.

- **PAY-008 — Packages, memberships, products and gift cards.** Cash-pay practices sell visit packages and wellness memberships that draw down per visit, products (braces, tape) with state sales tax, and gift cards, all on the patient ledger. **Acceptance evidence:** Sell a 5-visit package, attend two visits and see three left; sell a brace with sales tax and redeem a gift card.

## Insurance billing

- **INS-001 — Payers, plans, fee schedules and providers.** The practice records payers with their clearinghouse IDs, plans, contracted and standard fee schedules by CPT, each rendering provider's NPI, taxonomy, licence and payer enrolment, and each patient's policies with coordination of benefits order. **Acceptance evidence:** Set up Medicare, a commercial payer and a fee schedule, enrol two providers, and see a charge priced from the right schedule.

- **INS-002 — Eligibility and benefits checks.** Balm runs real-time eligibility (X12 270/271) through Claim.MD or Availity at intake and before each episode, records active coverage, therapy benefits, copay, coinsurance, deductible remaining and visit limits, and shows Medicare therapy amounts used so far this year. **Acceptance evidence:** Run eligibility for a test patient through the clearinghouse sandbox and see benefits, copay and remaining deductible stored on the policy.

- **INS-003 — Authorization and visit tracking.** Authorizations record payer, number, visits or units, CPT scope and date range; attended visits decrement them; Balm warns at a set remainder, warns or blocks booking past the limit or date, and shows "8 of 12 visits left" on the visit. **Acceptance evidence:** Add a 12-visit authorization, attend 8, see "4 left", try to book past the end date and be warned or blocked per setting.

- **INS-004 — Prior authorization requests.** Staff prepare authorization requests with the signed plan of care, evaluation and outcome scores, submit them through Availity or the payer's portal, and track status and the decision on the referral. **Acceptance evidence:** Prepare a request from a signed evaluation, record its submission and approval, and see the authorization created from the decision.

- **INS-005 — Claim creation and scrubbing.** Signed charges become professional claims (837P / CMS-1500) with rendering, billing and referring providers, place of service, diagnosis pointers, units and modifiers; a scrubber checks payer rules, NCCI edits and MUEs, missing authorization or certification, and timely-filing dates before anything is sent. **Acceptance evidence:** Create a claim from a signed visit with a missing referring NPI and an NCCI pair; the scrubber names both, the fixed claim passes.

- **INS-006 — Claim submission and acknowledgements.** Balm submits claims through Claim.MD (first) or Availity, records the 999 and 277CA acknowledgements, shows rejections with their reasons for correction, follows status (276/277), and prints CMS-1500 forms for payers outside the clearinghouse. Secondary claims go out after primary payment. **Acceptance evidence:** Submit a batch in the clearinghouse sandbox, receive acceptance for one and a rejection for another, correct and resubmit, and print a CMS-1500 for a paper payer.

- **INS-007 — ERA posting.** Balm imports electronic remittances (835) and posts payments, contractual adjustments and patient responsibility to each claim line with CARC and RARC codes, moves patient balances to statements, and matches the EFT deposit total. **Acceptance evidence:** Import a sandbox 835 covering paid, partly paid and denied lines; each line posts correctly and the deposit total matches the remittance.

- **INS-008 — Denials and A/R work queue.** Denied and unpaid claims form a work queue by payer, age and reason with the fix suggested from the CARC/RARC, corrected claims (frequency code 7), appeal letters from templates, and timely-filing deadlines; every action is recorded on the claim. **Acceptance evidence:** Receive a denial for a missing KX modifier, see it queued with the fix, send the corrected claim and see it paid.

- **INS-009 — Medicare therapy rules.** For Medicare beneficiaries Balm tracks the year's spending against the KX threshold (combined PT and SLP, separate OT) including amounts from other providers, applies the KX modifier when documentation supports it, flags the targeted medical review threshold, captures an ABN (CMS-R-131) for non-covered services, applies CQ/CO for assistant services, and holds each year's CMS amounts as dated settings. **Acceptance evidence:** Bill a beneficiary across the threshold and see KX applied with the documentation check; record an ABN for a maintenance visit and see the claim modifier.

- **INS-010 — Workers' comp, auto and injury cases.** Cases for workers' compensation, auto no-fault and personal-injury liens hold the claim number, adjuster, employer or attorney, and their own billing, authorizations and report requirements. **Acceptance evidence:** Open a workers' comp case, bill a visit to the carrier with the claim number, and send the required progress report to the adjuster.

- **INS-011 — Institutional claims for rehab agencies.** Practices enrolled as rehabilitation agencies bill on the institutional claim (837I / UB-04) with revenue codes, occurrence codes and the plan-of-care dates their payers require. **Acceptance evidence:** Configure a rehab-agency practice, bill a Medicare visit, and see an accepted 837I in the clearinghouse sandbox.

## Reporting and accounting

- **REPORT-001 — Operational reports.** Owners see visits, arrivals, cancellations and no-shows, plan-of-care completion (visits per episode, drop-off), new evaluations, practitioner utilisation and productivity, referral conversion and visit counts for payroll, filtered by date, location and practitioner, and export every report as CSV. **Acceptance evidence:** Run a month of synthetic visits and see each figure match a hand count; export each report and reopen it.

- **REPORT-002 — Financial reports.** Charges, payments, adjustments, A/R aging by payer and patient, collections per visit, days in A/R and deposit reconciliation, exported as CSV. **Acceptance evidence:** Bill, post an ERA and card payments for a month, and see the A/R aging and deposit report match the ledger.

- **REPORT-003 — Outcomes and MIPS quality reporting.** Outcome scores aggregate by diagnosis, practitioner and payer, and the practice captures the MIPS quality measures its clinicians report and exports them in the registry's submission format. **Acceptance evidence:** Record outcome measures across 20 episodes, see the change by practitioner, and export a MIPS measure file that validates against the registry's schema.

- **REPORT-004 — Daily close.** One screen lists what stands between today and getting paid: unsigned notes, visits without charges, uncollected copays, claims not sent, intakes not returned and authorizations running out, with one click to each. **Acceptance evidence:** End a day with one unsigned note, one uncollected copay and one unsent claim; the daily close lists all three, and clearing each empties the list.

- **ACCT-001 — Accounting handoff.** Balm syncs charges, payments, refunds, processor fees and deposits to QuickBooks Online or Xero (or Pantry), by day and by payment method, with mappings the owner reviews and every sync recorded and repeatable without duplicates. **Acceptance evidence:** Connect a QuickBooks Online sandbox, sync a day with card, ERA and cash payments, run it again, and see the books match without duplicates.

## HIPAA, audit, retention and portability

- **AUDIT-001 — Append-only access audit.** `bm_audit` is append-only. Opening a patient file, reading intake answers or notes, every change, every invoice or reminder download and every agent read of patient names add rows for that patient; audit rows carry no patient personal details; only the owner reads them. **Acceptance evidence:** Open a file, read intake and notes, download an invoice and read names with an agent key; the file's audit lists each, and an attempt to update or delete an audit row is refused.

- **ERASE-001 — Erasure fenced against old backups.** The owner erases a patient or staff member who has no health records; the erasure is journalled so a restore or import cannot bring them back, and a patient with health records is retained under `HIPAA-002`. **Acceptance evidence:** Erase an unused patient and staff member, restore an older archive and re-import the patient, and see both refused; try to erase a treated patient and be refused.

- **PORT-001 — Whole-clinic export and restore.** `rer export` writes the whole clinic as an archive; `rer import` restores it into an empty destination and refuses damaged archives and populated stores. **Acceptance evidence:** Export, damage a copy and see it refused, import into a populated store and see it refused, import into an empty one and see the clinic intact.

- **HIPAA-001 — HIPAA deployment readiness.** Before real patient data is entered, Balm walks the owner through a readiness check: the hosting account and every enabled subprocessor (mail, SMS, fax, clearinghouse, video, scribe model, backups) listed with whether a signed BAA is on file, encryption at rest and in transit, the HIPAA security risk analysis worksheet, and the named privacy and security officers; integrations that need a BAA stay off until one is recorded. **Acceptance evidence:** Enable SMS without a recorded BAA and be refused; record the BAAs and the risk analysis, and see the readiness check pass and its record exportable.

- **HIPAA-002 — Retention and destruction.** Health records are kept for the retention period the practice's state requires (with minors kept until majority plus the state's period), deletion is refused inside it, and records past it are destroyed only after a person approves a destruction list that is itself kept. **Acceptance evidence:** Set a 7-year retention, try to erase a treated patient and be refused, advance past retention, approve destruction and see the destruction record.

- **HIPAA-003 — Disclosure accounting and access reports.** Releases of records to anyone other than the patient (payers excepted as HIPAA allows) are logged as disclosures; the owner can produce a patient's access report and accounting of disclosures for any date range. **Acceptance evidence:** Release records to an attorney and a referring provider, then produce the patient's accounting of disclosures and access report listing each.

- **HIPAA-004 — Backups and recovery.** The clinic is backed up automatically to storage the owner controls, encrypted, with a restore drill the owner can run to a separate place and a recovery point shown on the dashboard. **Acceptance evidence:** Enable automatic backups, change data, restore the last backup to a scratch deployment and see the change present.

## Moving in

- **MOVE-001 — Reviewed patient import with undo.** The owner imports patients from a Cliniko patient CSV: preview every row with diagnostics and conflicts, apply exactly the reviewed preview, read the journal with the original file, and undo without losing patients who have since been booked or edited. **Acceptance evidence:** Preview, apply and undo a synthetic Cliniko file in which one patient was booked after import; the booked patient is kept and the journal says why.

- **MOVE-002 — WebPT migration.** From WebPT's data export Balm moves patients, insurance policies, appointments, case and episode records, chart PDFs, open authorizations and balances, with a reviewed mapping and an undo. **Acceptance evidence:** Import a real-shape WebPT export, reconcile counts and balances under `MOVE-006`, open a migrated chart PDF and book against a migrated authorization.

- **MOVE-003 — Jane migration.** From Jane's exports Balm moves patients, appointments, chart entries, documents, invoices and balances. **Acceptance evidence:** Import a real-shape Jane export and reconcile it under `MOVE-006`.

- **MOVE-004 — SimplePractice migration.** From SimplePractice's client, appointment, document and billing exports Balm moves patients, appointments, notes as documents, insurance and balances. **Acceptance evidence:** Import a real-shape SimplePractice export and reconcile it under `MOVE-006`.

- **MOVE-005 — Full Cliniko migration.** Beyond patients, Balm moves Cliniko appointments, treatment notes, attachments, invoices and balances from its exports or API key, reading US date formats. **Acceptance evidence:** Import a real-shape Cliniko account with US dates through the API, and reconcile it under `MOVE-006`.

- **MOVE-006 — Reconciled cutover.** Every migration ends with a reconciliation report: patient, appointment, document and invoice counts and balance totals in the source and in Balm, every unmapped record explained, and open A/R and authorizations carried; the owner approves the cutover. **Acceptance evidence:** Run a migration with one unmappable record and one balance difference; the report names both and cutover waits for the owner's approval.

## Mobile and integrations

- **MOBILE-001 — Tablet-first clinician web app.** Clinicians run the schedule, check-in, notes, home programs and payments on a tablet or phone browser at the treatment table, and a draft note survives a dropped connection. **Acceptance evidence:** Complete a visit end to end on a tablet viewport, drop the network mid-note and see the draft kept and saved on reconnect.

- **MOBILE-002 — Native clinician and patient apps.** iOS and Android apps give clinicians the schedule, notes, scribe recording and secure push alerts without PHI on the lock screen, and give patients their portal, home program, messages and payments. **Acceptance evidence:** Install both apps from TestFlight and an Android test track, record a scribe visit, sign the note and see a push alert with no clinical text.

- **INTEG-001 — API, webhooks, agent keys and FHIR export.** Owner-bound, scoped API keys (today's agent keys) and webhooks expose scheduling, patients, charges and payments to the practice's own tools; a patient's record exports as FHIR R4 US Core resources. Every key acts within `BALM-001`'s roles and is audited. **Acceptance evidence:** Create a scoped key, read appointments and prepare an invoice through the documented commands, receive a webhook for a booking, and export a patient as FHIR that validates against US Core.

- **INTEG-002 — Opt-in marketing contact sync.** Patients who opted in to marketing sync their name and email (never clinical data) to Mango or Mailchimp, and opting out in either place stops the sync. **Acceptance evidence:** Opt one patient in and one out, sync, and see only the opted-in contact with no clinical fields.

## Push further with agents

Every agent here works through `BALM-001`: an owner-bound key with a declared scope, a prepare-then-approve fence that records the digest of what a person approved, a visible pause, and an audit row for every read. Agents never sign notes, change a plan of care, submit an appeal, refund, write off or message a new recipient without the approval named in their clause.

- **AGENT-001 — Referral-to-collection case agent.** For each referral the agent follows the case from referral documents and consent through eligibility, authorization, plan-of-care certification, scheduled and attended visits, signed notes, claims, remittances and patient balance. It keeps a dated next-action list with cited evidence (the fax page, the 277CA line, the unsigned note), prepares the next permitted step (request the certification again, chase the payer, ask the patient for a card), sends only through approved channels and templates, and closes the case only when the claim and patient balance are reconciled. Clinicians confirm every clinical assertion; billing staff approve coding, appeals and financial exceptions. **Acceptance evidence:** Run a referral whose certification stalls and whose claim is denied; the agent cites each blocker, prepares the follow-ups for approval, waits on unapproved steps, and shows the case closed only after the paid ERA and zero patient balance.

- **AGENT-002 — Care continuity agent.** From cancellations, the waitlist, clinician capacity, authorization limits and plan-of-care dates, the agent proposes replacement visit sequences that keep the plan's frequency inside the authorization, offers them to patients after a clinician approves any change in cadence, and verifies the booking and coverage together. **Acceptance evidence:** Cancel two visits in a patient's plan; the agent proposes a sequence inside the authorization, the clinician approves, the patient accepts by text, and the bookings and remaining authorization agree.

- **AGENT-003 — Documentation defensibility check.** Before a note is signed, the agent reads the note, plan of care, billed minutes and the payer's documentation rules and lists what an auditor would question (skilled need not shown, units not supported, missing progress report), each with the rule cited; the clinician decides every change. **Acceptance evidence:** Draft a note billing 4 units with 40 minutes of mostly unskilled exercise; the agent names the unsupported unit and the missing skilled rationale with sources, and the clinician's edit clears them.

- **AGENT-004 — Denial resolver.** For each rejection and denial the agent reads the 277CA or 835 codes, the claim, note and authorization, explains the cause in plain language, and prepares the corrected claim or appeal letter with the evidence attached; a biller approves before anything is sent, and the agent watches for the payment. **Acceptance evidence:** Feed a sandbox denial for a missing authorization; the agent prepares an appeal citing the authorization and note, the biller approves, and the agent marks it resolved only when payment posts.

- **AGENT-005 — Month-end reconciliation.** The agent matches Stripe payouts, ERA EFT deposits, charges and accounting entries, explains every unmatched amount, and pursues missing remittances rather than marking claims paid; finance approves every allocation correction and refund. **Acceptance evidence:** Run a month with one missing ERA and one duplicated card payment; the agent explains both, requests the missing ERA and prepares the refund for approval.

- **AGENT-006 — Outcome follow-through.** For each episode the agent sends the clinician-chosen outcome questionnaires and home-program check-ins on the chosen cadence, chases missing responses within contact limits, and drafts a progress brief with scores, adherence and open questions for the clinician; it never diagnoses or changes treatment. **Acceptance evidence:** Run an episode with one missed questionnaire; the agent follows up once within limits and drafts a brief that the clinician edits into the progress report.

- **AGENT-007 — Front-desk inbox agent.** The agent reads incoming texts, emails, portal messages and faxes, sorts them (reschedule, billing question, new referral, records request, clinical question), drafts the reply or the action (a reschedule offer, a filed referral) for staff to approve, and routes clinical questions to the clinician untouched. **Acceptance evidence:** Send one of each message type; each is sorted and drafted correctly, the clinical one reaches the clinician without a drafted answer, and nothing is sent before approval.

- **AGENT-008 — Migration agent.** The agent reads an incumbent export, proposes the field mapping, explains every record it cannot map and every balance difference, and prepares the reconciliation report for `MOVE-006`; the owner approves the mapping and the cutover. **Acceptance evidence:** Give the agent a real-shape export with two unusual custom fields; it proposes a mapping, flags both fields with examples, and the import applies only after the owner approves.

## Honest boundaries

- **Not a clearinghouse or payer network.** Balm submits through Claim.MD and Availity under the practice's own enrolment; payer enrolment and credentialing (CAQH, PECOS) remain the practice's or its credentialing service's work, with Balm tracking the status per provider and payer.
- **Not a card processor or lender.** Card data stays with Stripe; funds settle to the practice's Stripe account; patient financing goes through a partner such as Cherry or CareCredit.
- **Not HIPAA compliance by hosting.** Running on Cloudflare does not make a practice compliant. Balm records the practice's BAAs, risk analysis and officers and keeps BAA-dependent integrations off until they exist (`HIPAA-001`); the practice remains the covered entity.
- **Not clinical judgement.** Clinicians decide diagnosis, medical necessity, plan of care and every statement in a signed note; agents and the scribe draft and check.
- **Not a phone system, payroll or HR system.** Calls run on the practice's phone provider; payroll and 1099/W-2 filing run in Gusto or ADP; staff HR records live in Willow or BambooHR.
- **Not DME supplier billing, e-prescribing or lab and imaging orders.** Products sell for cash under `PAY-008`; insurance billing for durable medical equipment goes through a DME billing partner.
- **US first.** USD, US payers, US time zones and US privacy law first; other countries' claiming systems (Medicare Australia, NHS) are not part of this target.

## Data flows and retained rules

The first-release rules stand: audit rows carry no patient personal details, agent keys never read notes or intake answers, approvals keep digests, invoice bytes are fixed at approval, and every write re-checks live authority in its batch. Each target integration adds a declared data flow in `seed.json → externals` in the same change that builds it:

- **Mail provider** (intake links, confirmations, reminders, statements notices): recipient address, practice name, visit time and links; never diagnosis or note text. A BAA-signing provider (for example Paubox or Amazon SES) is required once PHI could appear.
- **Twilio** (SMS): patient phone number, practice name, visit time, reply text.
- **Stripe** (cards): patient name, email, amounts and a Balm reference; Balm keeps only Stripe's customer, payment method and charge IDs.
- **Claim.MD and Availity** (eligibility, claims, remittances): the X12 transaction content, which is PHI, under the practice's BAA with the clearinghouse.
- **Fax provider, video provider, scribe model and backup storage**: the documents, video session, audio and archive they handle, each under a recorded BAA.
- **QuickBooks Online, Xero or Pantry**: patient name or account number, amounts, dates and payment method; no clinical data.
- **NPPES NPI registry**: NPI numbers and provider names looked up; no patient data.

## Homepage claims

Every capability the owner-accepted homepage states (claims table `evidence/br-balm/desk-built/CLAIMS.md`, 17 October 2026) maps to the clauses that deliver it. Status is the clauses' combined status: `done` when all are done, `missing` when all are missing, otherwise `partial`.

| # | Claim | Clauses | Status |
| ---: | --- | --- | --- |
| 1 | runs your clinic's schedule | `SCHED-001`, `SCHED-002`, `SCHED-004` | partial |
| 2 | intake | `INTAKE-001`, `INTAKE-002` | partial |
| 3 | notes | `CHART-001`, `CHART-002` | partial |
| 4 | reminders | `REMIND-001`, `COMM-001`, `COMM-002` | partial |
| 5 | bills insurance … through to paid | `INS-005`, `INS-006`, `INS-007` | missing |
| 6 | bills … patients through to paid | `BILL-001`, `PAY-001`, `PAY-002`, `PAY-004` | partial |
| 7 | 100% free, open source | `OWN-001` | partial |
| 8 | Tuesday schedule with visits | `SCHED-002` | partial |
| 9 | "daily note" signed | `CHART-002`, `CHART-004` | partial |
| 10 | Plan of care signed by Dr. Patel | `CHART-003` | missing |
| 11 | Auth: 8 of 12 visits left | `INS-003` | missing |
| 12 | Claim paid · Aetna · $142.18 | `INS-006`, `INS-007` | missing |
| 13 | Reminder sent | `COMM-001`, `COMM-002` | partial |
| 14 | Denied: missing KX modifier · Resubmitted | `INS-008`, `INS-009` | missing |
| 15 | Recurring visits | `SCHED-003` | missing |
| 16 | waitlists | `SCHED-005` | missing |
| 17 | online booking keep[s] the calendar full | `SCHED-001`, `SCHED-006` | partial |
| 18 | offers the slot to your waitlist by text / Confirmed by text | `SCHED-005`, `COMM-002` | missing |
| 19 | Patients fill in intake … from one link | `INTAKE-001` | done |
| 20 | sign consent | `INTAKE-003` | partial |
| 21 | add their insurance card | `INTAKE-004` | missing |
| 22 | Their home exercises … live in the same portal | `PORTAL-001`, `PORTAL-002` | missing |
| 23 | and messages | `PORTAL-003` | missing |
| 24 | PT, OT and speech templates for evaluations, daily notes, progress and discharge | `CHART-002` | missing |
| 25 | The scribe drafts from the visit | `CHART-012` | missing |
| 26 | you review and sign | `CHART-004`, `CHART-012` | partial |
| 27 | Billed CPT units, "8-minute rule · 3 units" | `CHART-006` | missing |
| 28 | Check eligibility | `INS-002` | missing |
| 29 | track authorizations | `INS-003` | missing |
| 30 | send claims through Claim.MD or Availity | `INS-006` | missing |
| 31 | Payments post from the ERA | `INS-007` | missing |
| 32 | denials arrive with the fix | `INS-008` | missing |
| 33 | All 14 notes signed · claims sent | `CHART-004`, `INS-006`, `REPORT-004` | partial |
| 34 | Cards on file | `PAY-002` | missing |
| 35 | text-to-pay links | `PAY-003` | missing |
| 36 | superbills | `PAY-005` | missing |
| 37 | clear statements | `PAY-004` | partial |
| 38 | Copays collect at check-in | `PAY-002`, `SCHED-008` | partial |
| 39 | Text and email reminders go out on their own | `COMM-001`, `COMM-002` | partial |
| 40 | Patients confirm or ask for a new time in one reply | `COMM-002` | missing |
| 41 | follows each referral from authorization to paid claim | `AGENT-001` | missing |
| 42 | spots what stalled, cites the record and lines up the next step / Send to payer | `AGENT-001`, `AGENT-004` | missing |
| 43 | Import patients … from … Cliniko | `MOVE-001`, `MOVE-005` | partial |
| 44 | appointments, notes and balances | `MOVE-002`, `MOVE-003`, `MOVE-004`, `MOVE-005` | partial |
| 45 | from WebPT, SimplePractice, Jane | `MOVE-002`, `MOVE-003`, `MOVE-004` | missing |
| 46 | check every total before you switch | `MOVE-006` | partial |
| 47 | Run Balm on your own computer (the five commands) | `OWN-001` | partial |
| 48 | keep every chart / Your charts, your database | `OWN-001`, `PORT-001` | partial |
| 49 | Export everything, any time | `PORT-001` | done |
| 50 | Telehealth: Video visits from the same calendar | `TELE-001` | missing |
| 51 | Home exercise programs | `PORTAL-002` | missing |
| 52 | Secure messaging | `PORTAL-003` | missing |
| 53 | Therapy cap tracking: KX threshold flagged | `INS-009`, `CHART-007` | missing |
| 54 | Plan of care signatures | `CHART-003` | missing |
| 55 | Audit log: Every chart view and change, recorded | `AUDIT-001` | done |
| 56 | Open source practice management for US therapy clinics | `OWN-001`, `US-001` | partial |
| 57 | Free and open source, MIT licensed | `OWN-001` | partial |

## Status

Judged from the code and tests at commit `5c2034837f1da71febeaf62f4ddde1882f97dce0` (17 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 12 | 0 | 0 | 12 |
| Target and push further | 0 | 26 | 60 | 86 |
| All | 12 | 26 | 60 | 98 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `BALM-001` | Live roles and server-side authority | published | done | `src/balm/domain/model.ts`; `src/balm/credentials.ts`; `tests/balm.test.mjs` |  |
| `SETUP-001` | Clinic, services, practitioners and hours | published | done | `src/balm/domain/clinic.ts`; `src/balm/ui/schedule.ts`; `tests/clinic.mjs`; `tests/harness.mjs` |  |
| `ROLE-002` | Billing, assistant, student and supervisor roles | target | partial | `src/balm/domain/model.ts` | Only owner, practitioner, reception and agent roles exist; no biller, assistant, student, supervisor or location roles |
| `SEC-001` | Two-step sign-in and session control | target | partial | `src/auth.server.ts`; `src/balm/credentials.ts` | Email-link sessions and immediate deactivation ship; no second step, session list, idle timeout or staff OIDC/SAML |
| `SEC-002` | Public doors that refuse abuse | target | partial | `src/balm/http.ts`; `src/balm/domain/booking.ts`; `tests/balm.test.mjs` | Origin checks, a pending-booking cap, hashed one-use intake tokens ship; no per-address or per-email rate limit, no portal or payment-link doors |
| `US-001` | US clinic defaults | target | partial | `src/balm/domain/invoices.ts`; `src/balm/movein/csv.ts` | USD and en-US dates ship; no NPI field, tax ID stored as an ABN column, no +1 phone validation, imports read DD/MM/YYYY |
| `OWN-001` | Owned, open-source and free | target | partial | `LICENSE`; `OPERATIONS.json`; `tests/archive.test.mjs` | MIT licence and the local install ship; no test proves the absence of undeclared outbound requests |
| `SCHED-001` | Online booking from real open times | published | done | `src/balm/domain/booking.ts`; `src/balm/ui/public.ts`; `tests/balm.test.mjs` |  |
| `SCHED-002` | Practitioner, room and equipment calendar | target | partial | `src/balm/ui/schedule.ts` | A per-day appointment list with intake flags; no week grid, rooms, equipment, drag to move or auth and balance flags |
| `SCHED-003` | Recurring visit series | target | missing |  | One appointment at a time; no series |
| `SCHED-004` | Reschedule, cancel and no-show policy | target | partial | `src/balm/domain/booking.ts` | Staff cancel and no-show ship; no reschedule, cancel reasons, late-cancel window or fees |
| `SCHED-005` | Waitlist that fills openings | target | missing |  | No waitlist or opening offers |
| `SCHED-006` | Patient self-service scheduling | target | partial | `src/balm/domain/booking.ts` | Returning patients matched at /book continue their file; no portal booking, self-reschedule or cancel, rules or embedding |
| `SCHED-007` | Service types, locations and availability rules | target | partial | `src/balm/domain/clinic.ts`; `src/balm/availability/engine.ts` | Services carry length and price and the engine accepts overrides; no locations, CPT defaults, per-service practitioners, stored holidays or buffers |
| `SCHED-008` | Check-in, attendance and change history | target | partial | `src/balm/domain/booking.ts`; `tests/balm.test.mjs` | Attended, no-show and cancelled are audited; no checked-in state, and attendance does not start a note or charge |
| `SCHED-009` | Calendar subscription | target | missing |  | No calendar feed |
| `INTAKE-001` | One-use intake bound to its form version | published | done | `src/balm/domain/intake.ts`; `src/balm/http.ts`; `tests/balm.test.mjs` |  |
| `INTAKE-002` | Intake packets and outcome questionnaires | target | partial | `src/balm/domain/intake.ts` | One versioned form with four question types; no packets per service or scored outcome questionnaires |
| `INTAKE-003` | Signed consents and policies | target | partial | `migrations/core/0015_balm.sql` | A required consent checkbox only; no signatures, guardian signer, fixed PDF or re-signing |
| `INTAKE-004` | Insurance and identity capture | target | missing |  | No insurance policies, card photos or ID capture |
| `PORTAL-001` | Patient portal | target | missing |  | No patient portal |
| `PORTAL-002` | Home exercise programs | target | missing |  | No exercise library or home programs |
| `PORTAL-003` | Secure messaging | target | missing |  | No patient messaging |
| `PORTAL-004` | Statements, receipts and superbills in the portal | target | missing |  | No portal documents or payments |
| `PORTAL-005` | Accessible, English and Spanish patient pages | target | missing |  | Patient pages are English only and unaudited against WCAG 2.2 AA |
| `PORTAL-006` | Patient access to their record | target | missing |  | No record request workflow or FHIR export |
| `CHART-001` | Private revisioned treatment notes | published | done | `src/balm/domain/notes.ts`; `tests/balm.test.mjs` |  |
| `CHART-002` | PT, OT and SLP templates | target | missing |  | One free-text note box; no discipline templates |
| `CHART-003` | Plan of care and physician certification | target | missing |  | No plan of care, goals or physician certification |
| `CHART-004` | Draft, sign, lock and amend | target | partial | `src/balm/domain/notes.ts`; `tests/balm.test.mjs` | Amendments keep revisions; no draft, sign or lock state, credentials or unsigned-note deadline |
| `CHART-005` | Objective measures and flowsheets | target | missing |  | No structured measures or flowsheets |
| `CHART-006` | Billing captured from the note | target | missing |  | No CPT codes, minutes, unit calculation or modifiers |
| `CHART-007` | Documentation compliance alerts | target | missing |  | No documentation compliance checks |
| `CHART-008` | Supervision and co-signature | target | missing |  | No supervision or co-signature |
| `CHART-009` | Attachments and searchable history | target | partial | `src/balm/domain/clients.ts`; `src/balm/domain/notes.ts` | Per-patient note and intake history; no attachments or search |
| `CHART-010` | Alerts and precautions | target | missing |  | No alerts or precautions |
| `CHART-011` | Clinical letters and exports | target | missing |  | No clinical letters or sends |
| `CHART-012` | Ambient scribe | target | missing |  | No scribe or recording |
| `CHART-013` | Care team access with audited emergency access | target | partial | `src/balm/domain/notes.ts` | Author-and-owner restriction ships; no care-team grants or break-glass access |
| `REF-001` | Referrals and referring providers | target | missing |  | No referrals, referring providers or NPI lookup |
| `REF-002` | Fax in and out | target | missing |  | No fax |
| `REF-003` | Episodes of care | target | missing |  | No episodes of care |
| `REMIND-001` | Reminder content a person approves | published | done | `src/balm/domain/reminders.ts`; `src/balm/domain/approvals.ts`; `tests/balm.test.mjs` |  |
| `COMM-001` | Delivered email confirmations and reminders | target | partial | `src/balm/http.ts`; `src/mail.server.mjs`; `tests/balm.test.mjs` | The booking email with the intake link is sent through the mail provider; no scheduled reminders, change notices or delivery state on the file |
| `COMM-002` | Two-way text messages | target | missing |  | No SMS |
| `COMM-003` | Communication history on the file | target | partial | `src/balm/domain/reminders.ts` | Approved reminder drafts are kept; no sent and received history |
| `COMM-004` | Follow-ups and recalls | target | missing |  | No follow-up or recall sequences |
| `TELE-001` | Video visits from the calendar | target | missing |  | No video visits |
| `BILL-001` | Approved, numbered invoices with fixed bytes | published | done | `src/balm/domain/invoices.ts`; `tests/balm.test.mjs` |  |
| `PAY-001` | Payments recorded once per reference | published | done | `src/balm/domain/invoices.ts`; `tests/balm.test.mjs` |  |
| `PAY-002` | Cards on file and payments at check-in | target | missing |  | No card processing |
| `PAY-003` | Payment links and online prepayment | target | missing |  | No payment links or prepayment |
| `PAY-004` | Statements, receipts, adjustments and refunds | target | partial | `src/balm/domain/invoices.ts` | Per-visit invoices with void and outstanding amounts; no ledger, statements, receipts, adjustments, credits or refunds |
| `PAY-005` | Superbills | target | missing |  | Invoices carry no CPT, ICD-10 or NPI |
| `PAY-006` | Payment plans and balance reminders | target | missing |  | No payment plans or balance reminders |
| `PAY-007` | Good Faith Estimates | target | missing |  | No Good Faith Estimates |
| `PAY-008` | Packages, memberships, products and gift cards | target | missing |  | No packages, memberships, products or gift cards |
| `INS-001` | Payers, plans, fee schedules and providers | target | missing |  | No payers, fee schedules, provider enrolment or policies |
| `INS-002` | Eligibility and benefits checks | target | missing |  | No eligibility checks |
| `INS-003` | Authorization and visit tracking | target | missing |  | No authorization tracking |
| `INS-004` | Prior authorization requests | target | missing |  | No prior authorization requests |
| `INS-005` | Claim creation and scrubbing | target | missing |  | No claims or scrubber |
| `INS-006` | Claim submission and acknowledgements | target | missing |  | No clearinghouse connection |
| `INS-007` | ERA posting | target | missing |  | No ERA import |
| `INS-008` | Denials and A/R work queue | target | missing |  | No denial or A/R queue |
| `INS-009` | Medicare therapy rules | target | missing |  | No Medicare rules |
| `INS-010` | Workers' comp, auto and injury cases | target | missing |  | No workers comp, auto or injury cases |
| `INS-011` | Institutional claims for rehab agencies | target | missing |  | No institutional claims |
| `REPORT-001` | Operational reports | target | partial | `src/balm/domain/index.ts` | Role-scoped working lists only; no reports or CSV export |
| `REPORT-002` | Financial reports | target | missing |  | No financial reports |
| `REPORT-003` | Outcomes and MIPS quality reporting | target | missing |  | No outcome or MIPS reporting |
| `REPORT-004` | Daily close | target | missing |  | No daily close |
| `ACCT-001` | Accounting handoff | target | missing |  | No accounting sync |
| `AUDIT-001` | Append-only access audit | published | done | `migrations/core/0015_balm.sql`; `src/balm/domain/clients.ts`; `tests/balm.test.mjs` |  |
| `ERASE-001` | Erasure fenced against old backups | published | done | `src/balm/domain/clients.ts`; `src/balm/domain/clinic.ts`; `tests/balm.test.mjs`; `tests/archive.test.mjs` |  |
| `PORT-001` | Whole-clinic export and restore | published | done | `src/balm/archive-policy.mjs`; `tests/archive.test.mjs` |  |
| `HIPAA-001` | HIPAA deployment readiness | target | missing |  | No readiness check or BAA register; real patient data waits for a privacy review |
| `HIPAA-002` | Retention and destruction | target | partial | `src/balm/domain/clients.ts`; `tests/balm.test.mjs` | Erasure is refused for patients with health records; no retention period, minors rule or approved destruction |
| `HIPAA-003` | Disclosure accounting and access reports | target | partial | `src/balm/domain/clients.ts`; `migrations/core/0015_balm.sql` | A per-patient access audit exists; no disclosure log or date-range reports |
| `HIPAA-004` | Backups and recovery | target | partial | `src/balm/archive-policy.mjs`; `tests/archive.test.mjs` | Manual export and restore only; no automatic encrypted backups or restore drill |
| `MOVE-001` | Reviewed patient import with undo | published | done | `src/balm/movein/index.ts`; `src/balm/movein/csv.ts`; `tests/balm.test.mjs` |  |
| `MOVE-002` | WebPT migration | target | missing |  | No WebPT import |
| `MOVE-003` | Jane migration | target | missing |  | No Jane import |
| `MOVE-004` | SimplePractice migration | target | missing |  | No SimplePractice import |
| `MOVE-005` | Full Cliniko migration | target | partial | `src/balm/movein/csv.ts`; `docs/MOVE-IN.md` | Six-column patient CSV from a synthetic fixture only; no appointments, notes, attachments, balances, API or US dates |
| `MOVE-006` | Reconciled cutover | target | partial | `src/balm/movein/index.ts` | The preview lists every row, diagnostic and conflict; no counts or balance totals against the source, no cutover approval |
| `MOBILE-001` | Tablet-first clinician web app | target | partial | `src/balm/ui/style.ts` | One responsive breakpoint; no tested tablet journey or offline draft |
| `MOBILE-002` | Native clinician and patient apps | target | missing |  | No native apps |
| `INTEG-001` | API, webhooks, agent keys and FHIR export | target | partial | `src/balm/credentials.ts`; `docs/AGENT-COMMANDS.md`; `tests/balm.test.mjs` | Owner-bound agent keys read names, appointments and invoices and prepare work; no general scoped API, webhooks or FHIR export |
| `INTEG-002` | Opt-in marketing contact sync | target | missing |  | No marketing contact sync |
| `AGENT-001` | Referral-to-collection case agent | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-002` | Care continuity agent | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-003` | Documentation defensibility check | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-004` | Denial resolver | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-005` | Month-end reconciliation | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-006` | Outcome follow-through | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-007` | Front-desk inbox agent | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
| `AGENT-008` | Migration agent | push-further | missing |  | No agent behaviour yet; only the agent-key prepare-and-approve fence of BALM-001 exists |
