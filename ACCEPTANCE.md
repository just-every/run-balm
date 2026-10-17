# Acceptance

Balm's acceptance is the journey each clause of [CONTRACT.md](CONTRACT.md) names, run through a public door: the app, `/book`, `/intake/<token>`, the portal, the API or the `rer` commands, with fakes only at the paid or network edge (clearinghouse, card processor, SMS, fax and mail sandboxes). A clause is accepted when its journey passes, not when code exists. The status beside each clause is judged from the code and tests at commit `5c2034837f1da71febeaf62f4ddde1882f97dce0` (17 October 2026): 12 done, 26 partial and 60 missing of 98 clauses.

## First release

These journeys are accepted and covered by `tests/balm.test.mjs` and `tests/archive.test.mjs`:

- The owner sets up the clinic (name, time zone, services, practitioners and their weekly hours) and invites practitioners and reception, who each see and change only what their role allows.
- A new client books online at `/book` from the practitioner's real open times, gets a private link to the intake form, and sends it once; a taken slot is refused, even when two people race for it.
- A practitioner reads the intake and writes a treatment note for their client. Only that practitioner and the owner can read it; amendments keep every earlier revision.
- Reception or the owner prepares the invoice for an attended visit, a person approves it, and it is numbered and exported as the same bytes every time; payments received elsewhere are recorded once per reference.
- An agent key can prepare invoices, appointment reminder text and new intake-form versions; only a signed-in person approves them, and each approval is recorded with the digest of what was approved. Agents never read notes or intake answers.
- Every opening of a client file, every read of intake answers or notes, every change, download and agent read appears in that file's access audit, which only the owner reads.
- The owner moves patients in from a documented-shape Cliniko patient CSV: preview, apply that exact preview, read the journal with the original file, and undo it without losing clients who have since been booked or edited.
- The owner exports and restores the whole clinic with `rer export` / `rer import` (damaged archives and populated destinations are refused) and erases a client or staff member who has no health records, fenced against older backups.

The first release left out insurance claiming, card payments, sent reminders, recurring appointments, a patient portal, telehealth video and multi-location clinics. The target below requires each of them; it still excludes prescribing and clinical decision support (see the contract's Honest boundaries).

# Target journeys

Each clause below is listed with its status and the journey that accepts it.

## Clinic setup, roles and security

- **BALM-001 — Live roles and server-side authority** (done). Call every page and handler signed out, as each role, with a deactivated staff member and with a revoked or foreign agent key; each is refused or scoped by role, and an agent-prepared item is approved only by a signed-in person whose approval records the digest.
- **SETUP-001 — Clinic, services, practitioners and hours** (done). From a fresh install, complete the checklist through the app, invite a practitioner and a receptionist, and see the public booking page offer only the practitioner's hours.
- **ROLE-002 — Billing, assistant, student and supervisor roles** (partial). Sign in as each new role and attempt every read and write in the access matrix; allowed actions succeed, others are refused with no write, and each refusal is audited.
- **SEC-001 — Two-step sign-in and session control** (partial). Enforce two-step sign-in, sign in with and without the second step, let a session idle past the timeout, and sign out a device remotely; the next request from each refused session is denied.
- **SEC-002 — Public doors that refuse abuse** (partial). Post to each public door cross-origin, replay a used intake link, exceed the booking cap and the rate limit, and inspect storage; each is refused and no raw token is stored.
- **US-001 — US clinic defaults** (partial). Set up a clinic in America/Chicago, book, invoice and import a patient file with US dates; every screen, file and message shows USD, en-US dates, +1 numbers and the practice's EIN and NPI.
- **OWN-001 — Owned, open-source and free** (partial). Install from a clean checkout with the documented commands, run the clinic loop, and observe no outbound request other than the declared integrations the owner enabled.

## Scheduling

- **SCHED-001 — Online booking from real open times** (done). Book online for a new patient, see the slot disappear and the intake email sent, book a taken or off-grid slot and be refused, and race two bookings for one slot and see exactly one succeed.
- **SCHED-002 — Practitioner, room and equipment calendar** (partial). Book two practitioners into one room at the same time and see the second refused; move a visit by drag and see its history; read the week view for three practitioners with each visit's flags.
- **SCHED-003 — Recurring visit series** (missing). Book a 12-visit series that collides with a holiday and an existing visit; see the conflicts named, resolve them, and cancel "this and following" from visit 8 with earlier visits untouched.
- **SCHED-004 — Reschedule, cancel and no-show policy** (partial). Reschedule a visit and see one appointment with its history; cancel inside the late window and see the fee proposed, approved and charged once; mark a no-show and see it in attendance reports.
- **SCHED-005 — Waitlist that fills openings** (missing). Put three patients on the waitlist, cancel a matching visit, accept from the second patient's text reply after the first lets the hold lapse, and see one booking and a "slot taken" message to the third.
- **SCHED-006 — Patient self-service scheduling** (partial). As a returning patient, book at `/book` and land in the same file; as a portal patient, book a follow-up, reschedule it inside the rules, and be refused outside notice or past the authorized visit count; book through the page embedded on a test website.
- **SCHED-007 — Service types, locations and availability rules** (partial). Create two locations, an evaluation and a follow-up service and a day off; online booking offers each service only where and when its rules allow.
- **SCHED-008 — Check-in, attendance and change history** (partial). Book, check in and mark attended, then mark another visit no-show and another cancelled; each visit's history lists every change and its actor.
- **SCHED-009 — Calendar subscription** (missing). Subscribe to the feed, book and cancel a visit, see the feed follow; revoke the feed and see the old address refused.

## Intake and patient portal

- **INTAKE-001 — One-use intake bound to its form version** (done). Book online, open the emailed link, submit the intake, replay the link and be refused; read the answers as the treating practitioner and be refused as reception and as another practitioner.
- **INTAKE-002 — Intake packets and outcome questionnaires** (partial). Publish a PT packet with the LEFS, answer it as a patient, see the score in the chart, publish a new version and see earlier answers still bound to the old one.
- **INTAKE-003 — Signed consents and policies** (partial). Sign each consent as a parent for a minor, download the fixed PDF, change the policy and see the patient asked to re-sign the new version only.
- **INTAKE-004 — Insurance and identity capture** (missing). Complete intake with two policies and card photos; see the policies on the file, missing subscriber fields refused, and an eligibility request created.
- **PORTAL-001 — Patient portal** (missing). Sign in as a patient and as a guardian of two children, see only their own records, complete a form, and update insurance with the change audited.
- **PORTAL-002 — Home exercise programs** (missing). Assign a 5-exercise program from a daily note, open it as the patient, log three sessions, and see adherence in the next note.
- **PORTAL-003 — Secure messaging** (missing). Send a message with a photo as a patient, see an alert with no clinical text, reply as the practitioner, and find the thread in the file and the audit.
- **PORTAL-004 — Statements, receipts and superbills in the portal** (missing). After a paid visit and an unpaid one, open the portal and download the receipt and superbill, then pay the balance and see it at zero.
- **PORTAL-005 — Accessible, English and Spanish patient pages** (missing). Complete booking and intake in Spanish with a screen reader and keyboard only; an automated and manual WCAG 2.2 AA review of each patient page passes.
- **PORTAL-006 — Patient access to their record** (missing). Request the record as a patient, see the due date on the staff work queue, release it, and download both formats from the portal.

## Clinical documentation

- **CHART-001 — Private revisioned treatment notes** (done). Write and amend a note as a practitioner; read every revision as the author and the owner, and be refused as reception and another practitioner.
- **CHART-002 — PT, OT and SLP templates** (missing). Document an OT evaluation, three daily notes, a progress report and a discharge in the OT templates; each carries forward what it should, and a template change leaves signed notes unchanged.
- **CHART-003 — Plan of care and physician certification** (missing). Sign an evaluation, send its plan of care, sign it as the physician through the link, and see the certification date and recertification due date on the case; let it lapse and see visits flagged.
- **CHART-004 — Draft, sign, lock and amend** (partial). Sign a note, try to edit it and be offered an addendum, add one, and read both the original and the addendum; an unsigned note past 24 hours appears on the daily close.
- **CHART-005 — Objective measures and flowsheets** (missing). Record knee flexion and LEFS at evaluation and three later visits; the progress report shows the change and the graph matches the entries.
- **CHART-006 — Billing captured from the note** (missing). Document 38 minutes across 97110 and 97140 and one untimed 97161 for a Medicare patient; the charge shows 3 timed units distributed by the rule, the right modifiers and diagnosis pointers.
- **CHART-007 — Documentation compliance alerts** (missing). Reach the 10th visit without a progress report, an expired certification and a KX-threshold patient; each warning appears before signing and on the daily close.
- **CHART-008 — Supervision and co-signature** (missing). Document as a student, co-sign as the supervisor, and see the note locked with both signatures and the claim under the supervisor.
- **CHART-009 — Attachments and searchable history** (partial). Attach a faxed MRI report and two photos, search the chart for "MRI", and open the result; reception without clinical rights is refused.
- **CHART-010 — Alerts and precautions** (missing). Add a weight-bearing precaution and see it on the calendar visit, check-in and the next note.
- **CHART-011 — Clinical letters and exports** (missing). Send a progress letter to the referring physician by fax and to the patient by portal; both sends appear on the file with their content fixed.
- **CHART-012 — Ambient scribe** (missing). Record a consented visit, review the draft, change one statement and sign; the signed note shows the clinician as author, the audio is gone, and a visit without consent offers no recording.
- **CHART-013 — Care team access with audited emergency access** (partial). Grant a covering clinician access, read as them, revoke and be refused; break glass as another clinician and see the owner's notice and the audit row.

## Referrals and care coordination

- **REF-001 — Referrals and referring providers** (missing). Enter three referrals with NPI lookup, schedule two and mark one lost; the referral report shows conversion by provider and source.
- **REF-002 — Fax in and out** (missing). Receive a referral fax, file it to a new referral, send a plan of care by fax and see the confirmation on the file.
- **REF-003 — Episodes of care** (missing). Open two episodes for one patient, document in both, and see visit counts, authorization use and outcomes kept apart.

## Reminders and patient communication

- **REMIND-001 — Reminder content a person approves** (done). Prepare a reminder with an agent key, approve it as a person, and export the exact approved text with the approval digest recorded.
- **COMM-001 — Delivered email confirmations and reminders** (partial). Book a visit and see the confirmation and intake email delivered; advance the clock and see the reminders sent once each with delivery recorded; a failed delivery shows on the file.
- **COMM-002 — Two-way text messages** (missing). Send a reminder by SMS, reply C and see the visit confirmed, reply R and see a reschedule request, reply STOP and see no further texts; a patient without consent gets none.
- **COMM-003 — Communication history on the file** (partial). Exchange an email, a text, a portal message and a fax with one patient and log a call; the file lists all five with their states.
- **COMM-004 — Follow-ups and recalls** (missing). Leave a patient with an open plan of care and no next visit, see the outreach sent, book a visit and see the sequence stop.

## Telehealth

- **TELE-001 — Video visits from the calendar** (missing). Book a video visit, join as patient and clinician, document and sign; the claim shows POS 10 and modifier 95 for a commercial payer that requires them.

## Patient billing and payments

- **BILL-001 — Approved, numbered invoices with fixed bytes** (done). Prepare, change the visit, see approval refused, re-prepare and approve; download the invoice twice and get identical bytes.
- **PAY-001 — Payments recorded once per reference** (done). Record a check payment, record the same reference again and be refused, and try to exceed the invoice and be refused.
- **PAY-002 — Cards on file and payments at check-in** (missing). Save a card in intake, charge a $30 copay at check-in, refund it with approval, and see the Stripe charge and refund mirrored on the patient's ledger.
- **PAY-003 — Payment links and online prepayment** (missing). Text a link for a $120 balance, pay it, and see the balance at zero; book a prepaid service online and see the payment on the visit.
- **PAY-004 — Statements, receipts, adjustments and refunds** (partial). Bill three visits, pay one, write off part of another with approval, and send a statement that matches the ledger.
- **PAY-005 — Superbills** (missing). Produce a superbill for a month of visits and check every required field against the signed notes and ledger.
- **PAY-006 — Payment plans and balance reminders** (missing). Create a 3-month plan and see each charge post; leave a balance unpaid and see the reminder sequence and the review-list entry.
- **PAY-007 — Good Faith Estimates** (missing). Book a self-pay evaluation, see the estimate issued and kept, bill above it by $400 and see the flag.
- **PAY-008 — Packages, memberships, products and gift cards** (missing). Sell a 5-visit package, attend two visits and see three left; sell a brace with sales tax and redeem a gift card.

## Insurance billing

- **INS-001 — Payers, plans, fee schedules and providers** (missing). Set up Medicare, a commercial payer and a fee schedule, enrol two providers, and see a charge priced from the right schedule.
- **INS-002 — Eligibility and benefits checks** (missing). Run eligibility for a test patient through the clearinghouse sandbox and see benefits, copay and remaining deductible stored on the policy.
- **INS-003 — Authorization and visit tracking** (missing). Add a 12-visit authorization, attend 8, see "4 left", try to book past the end date and be warned or blocked per setting.
- **INS-004 — Prior authorization requests** (missing). Prepare a request from a signed evaluation, record its submission and approval, and see the authorization created from the decision.
- **INS-005 — Claim creation and scrubbing** (missing). Create a claim from a signed visit with a missing referring NPI and an NCCI pair; the scrubber names both, the fixed claim passes.
- **INS-006 — Claim submission and acknowledgements** (missing). Submit a batch in the clearinghouse sandbox, receive acceptance for one and a rejection for another, correct and resubmit, and print a CMS-1500 for a paper payer.
- **INS-007 — ERA posting** (missing). Import a sandbox 835 covering paid, partly paid and denied lines; each line posts correctly and the deposit total matches the remittance.
- **INS-008 — Denials and A/R work queue** (missing). Receive a denial for a missing KX modifier, see it queued with the fix, send the corrected claim and see it paid.
- **INS-009 — Medicare therapy rules** (missing). Bill a beneficiary across the threshold and see KX applied with the documentation check; record an ABN for a maintenance visit and see the claim modifier.
- **INS-010 — Workers' comp, auto and injury cases** (missing). Open a workers' comp case, bill a visit to the carrier with the claim number, and send the required progress report to the adjuster.
- **INS-011 — Institutional claims for rehab agencies** (missing). Configure a rehab-agency practice, bill a Medicare visit, and see an accepted 837I in the clearinghouse sandbox.

## Reporting and accounting

- **REPORT-001 — Operational reports** (partial). Run a month of synthetic visits and see each figure match a hand count; export each report and reopen it.
- **REPORT-002 — Financial reports** (missing). Bill, post an ERA and card payments for a month, and see the A/R aging and deposit report match the ledger.
- **REPORT-003 — Outcomes and MIPS quality reporting** (missing). Record outcome measures across 20 episodes, see the change by practitioner, and export a MIPS measure file that validates against the registry's schema.
- **REPORT-004 — Daily close** (missing). End a day with one unsigned note, one uncollected copay and one unsent claim; the daily close lists all three, and clearing each empties the list.
- **ACCT-001 — Accounting handoff** (missing). Connect a QuickBooks Online sandbox, sync a day with card, ERA and cash payments, run it again, and see the books match without duplicates.

## HIPAA, audit, retention and portability

- **AUDIT-001 — Append-only access audit** (done). Open a file, read intake and notes, download an invoice and read names with an agent key; the file's audit lists each, and an attempt to update or delete an audit row is refused.
- **ERASE-001 — Erasure fenced against old backups** (done). Erase an unused patient and staff member, restore an older archive and re-import the patient, and see both refused; try to erase a treated patient and be refused.
- **PORT-001 — Whole-clinic export and restore** (done). Export, damage a copy and see it refused, import into a populated store and see it refused, import into an empty one and see the clinic intact.
- **HIPAA-001 — HIPAA deployment readiness** (missing). Enable SMS without a recorded BAA and be refused; record the BAAs and the risk analysis, and see the readiness check pass and its record exportable.
- **HIPAA-002 — Retention and destruction** (partial). Set a 7-year retention, try to erase a treated patient and be refused, advance past retention, approve destruction and see the destruction record.
- **HIPAA-003 — Disclosure accounting and access reports** (partial). Release records to an attorney and a referring provider, then produce the patient's accounting of disclosures and access report listing each.
- **HIPAA-004 — Backups and recovery** (partial). Enable automatic backups, change data, restore the last backup to a scratch deployment and see the change present.

## Moving in

- **MOVE-001 — Reviewed patient import with undo** (done). Preview, apply and undo a synthetic Cliniko file in which one patient was booked after import; the booked patient is kept and the journal says why.
- **MOVE-002 — WebPT migration** (missing). Import a real-shape WebPT export, reconcile counts and balances under `MOVE-006`, open a migrated chart PDF and book against a migrated authorization.
- **MOVE-003 — Jane migration** (missing). Import a real-shape Jane export and reconcile it under `MOVE-006`.
- **MOVE-004 — SimplePractice migration** (missing). Import a real-shape SimplePractice export and reconcile it under `MOVE-006`.
- **MOVE-005 — Full Cliniko migration** (partial). Import a real-shape Cliniko account with US dates through the API, and reconcile it under `MOVE-006`.
- **MOVE-006 — Reconciled cutover** (partial). Run a migration with one unmappable record and one balance difference; the report names both and cutover waits for the owner's approval.

## Mobile and integrations

- **MOBILE-001 — Tablet-first clinician web app** (partial). Complete a visit end to end on a tablet viewport, drop the network mid-note and see the draft kept and saved on reconnect.
- **MOBILE-002 — Native clinician and patient apps** (missing). Install both apps from TestFlight and an Android test track, record a scribe visit, sign the note and see a push alert with no clinical text.
- **INTEG-001 — API, webhooks, agent keys and FHIR export** (partial). Create a scoped key, read appointments and prepare an invoice through the documented commands, receive a webhook for a booking, and export a patient as FHIR that validates against US Core.
- **INTEG-002 — Opt-in marketing contact sync** (missing). Opt one patient in and one out, sync, and see only the opted-in contact with no clinical fields.

## Push further with agents

- **AGENT-001 — Referral-to-collection case agent** (missing). Run a referral whose certification stalls and whose claim is denied; the agent cites each blocker, prepares the follow-ups for approval, waits on unapproved steps, and shows the case closed only after the paid ERA and zero patient balance.
- **AGENT-002 — Care continuity agent** (missing). Cancel two visits in a patient's plan; the agent proposes a sequence inside the authorization, the clinician approves, the patient accepts by text, and the bookings and remaining authorization agree.
- **AGENT-003 — Documentation defensibility check** (missing). Draft a note billing 4 units with 40 minutes of mostly unskilled exercise; the agent names the unsupported unit and the missing skilled rationale with sources, and the clinician's edit clears them.
- **AGENT-004 — Denial resolver** (missing). Feed a sandbox denial for a missing authorization; the agent prepares an appeal citing the authorization and note, the biller approves, and the agent marks it resolved only when payment posts.
- **AGENT-005 — Month-end reconciliation** (missing). Run a month with one missing ERA and one duplicated card payment; the agent explains both, requests the missing ERA and prepares the refund for approval.
- **AGENT-006 — Outcome follow-through** (missing). Run an episode with one missed questionnaire; the agent follows up once within limits and drafts a brief that the clinician edits into the progress report.
- **AGENT-007 — Front-desk inbox agent** (missing). Send one of each message type; each is sorted and drafted correctly, the clinical one reaches the clinician without a drafted answer, and nothing is sent before approval.
- **AGENT-008 — Migration agent** (missing). Give the agent a real-shape export with two unusual custom fields; it proposes a mapping, flags both fields with examples, and the import applies only after the owner approves.

## Before real patient data

Real patient data waits for `HIPAA-001`: the readiness check, the recorded BAAs and the risk analysis. The Cliniko fixture is synthetic; real export compatibility is claimed only when `MOVE-005` and `MOVE-006` pass on a real-shape export. Provider journeys (clearinghouse, Stripe, Twilio, fax, video, accounting) run against each provider's sandbox; a passing sandbox journey does not establish production enrolment with a payer.
