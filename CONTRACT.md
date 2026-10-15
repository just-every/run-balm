# Balm contract

BALM-001. Every `/app` page and `/api/balm` handler resolves the live actor from a native session (or, at `/api/balm/agent/*`, an owner-bound agent key) and enforces its role in the handler; every write re-checks that authority inside the same D1 batch. Roles: the owner; practitioners, who see only clients they are booked with; reception, who see every file but never intake answers or treatment notes; and agent keys, which only prepare invoices, reminder text and intake form versions. A person approves every preparation, and the approval keeps the SHA-256 of the exact approved content. Deactivating staff or revoking a key takes effect on the next request.

Public doors are `/book` (new-client online booking from the practitioner's open times, refusing taken or invalid slots in the same batch that inserts the appointment) and `/intake/<token>` (a one-use link that accepts answers once, bound to the exact form version). Treatment notes are readable only by their author and the owner, and amendments add revisions. Invoices are numbered and their bytes fixed only on a person's approval, and approval is refused if any frozen fact changed. External payment references are unique and payments cannot exceed the invoice.

`bm_audit` is append-only. Opening a client file, reading intake answers or notes, every change, every invoice or reminder download and every agent read of client names add rows for that client; audit rows carry no client personal details.

Public-door integration coverage is in tests/balm.test.mjs; CLI archive coverage is in tests/archive.test.mjs. No hosted provider delivery, claiming integration or real-export compatibility is claimed.
