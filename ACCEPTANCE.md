# First release

- The owner sets up the clinic (name, time zone, services, practitioners and their weekly hours) and invites practitioners and reception, who each see and change only what their role allows.
- A new client books online at `/book` from the practitioner's real open times, gets a private link to the intake form, and sends it once; a taken slot is refused, even when two people race for it.
- A practitioner reads the intake and writes a treatment note for their client. Only that practitioner and the owner can read it; amendments keep every earlier revision.
- Reception or the owner prepares the invoice for an attended visit, a person approves it, and it is numbered and exported as the same bytes every time; payments received elsewhere are recorded once per reference.
- An agent key can prepare invoices, appointment reminder text and new intake-form versions; only a signed-in person approves them, and each approval is recorded with the digest of what was approved. Agents never read notes or intake answers.
- Every opening of a client file, every read of intake answers or notes, every change, download and agent read appears in that file's access audit, which only the owner reads.
- The owner moves patients in from a documented-shape Cliniko patient CSV: preview, apply that exact preview, read the journal with the original file, and undo it without losing clients who have since been booked or edited.
- The owner exports and restores the whole clinic with `rer export` / `rer import` (damaged archives and populated destinations are refused) and erases a client or staff member who has no health records, fenced against older backups.

Not needed in this release: Medicare, DVA, NDIS or health-fund claiming, card payments, sending email reminders, prescribing, My Health Record, telehealth video, clinical decision support, multi-location clinics, recurring appointments, a client portal, a domain purchase, real provider calls or the visual design round. The Cliniko fixture is synthetic; no real export compatibility is claimed. Real patient data waits for a privacy review.
