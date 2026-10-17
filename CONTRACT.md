# Balm contract

BALM-001. Every `/app` page and `/api/balm` handler resolves the live actor from a native session (or, at `/api/balm/agent/*`, an owner-bound agent key) and enforces its role in the handler; every write re-checks that authority inside the same D1 batch. Roles: the owner; practitioners, who see only clients they are booked with; reception, who see every file but never intake answers or treatment notes; and agent keys, which only prepare invoices, reminder text and intake form versions. A person approves every preparation, and the approval keeps the SHA-256 of the exact approved content. Deactivating staff or revoking a key takes effect on the next request.

Public doors are `/book` (new-client online booking from the practitioner's open times, refusing taken or invalid slots in the same batch that inserts the appointment) and `/intake/<token>` (a one-use link that accepts answers once, bound to the exact form version). Treatment notes are readable only by their author and the owner, and amendments add revisions. Invoices are numbered and their bytes fixed only on a person's approval, and approval is refused if any frozen fact changed. External payment references are unique and payments cannot exceed the invoice.

`bm_audit` is append-only. Opening a client file, reading intake answers or notes, every change, every invoice or reminder download and every agent read of client names add rows for that client; audit rows carry no client personal details.

BALM-002. The schedule is a calendar by day or week and by practitioner or room in the clinic time zone. Staff book, move (the edit form or a drag) and cancel visits; every booking, move, recurring series and waitlist acceptance re-checks in the same D1 batch that no other live visit of that practitioner or that room overlaps, and staff placements stay inside the practitioner's hours. A recurring series is checked date by date before anything is saved: a conflicting date is shown and saves only once a person moved or skipped it, the whole series books in one batch, and skipped dates are recorded. One visit or the rest of a series can be moved or canceled; moving the rest changes none if any would conflict. The waitlist holds clients per practitioner (or any) and service in a date window. A canceled visit at least two hours ahead is offered by email to every fitting entry through a private `/offer/<token>` link (only its hash is stored); the first acceptance books the visit and closes the offer in one batch, later ones are refused, and the others are emailed that it is taken. Offers close one hour before the visit. Text-message offers wait for an SMS provider.

## Status

| Claim (docs/CLAIMS.md row) | Status |
|---|---|
| 1 Calendar schedule: day and week, practitioner and room, by status, move with overlaps refused | code |
| 15 Recurring visits with conflicts shown before saving | code |
| 16 Waitlists | code |
| 18 Freed slot offered to the waitlist | partly: by email; not by text until an SMS provider exists |

Public-door integration coverage is in tests/balm.test.mjs and tests/schedule.test.mjs; CLI archive coverage is in tests/archive.test.mjs. No hosted provider delivery, claiming integration or real-export compatibility is claimed.
