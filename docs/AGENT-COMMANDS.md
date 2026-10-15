# Agent commands

An agent key lets an assistant read the clinic's working state and prepare work. A signed-in person approves every preparation; the approval is recorded with the SHA-256 of the exact content approved.

Create a key in **Agent access** (owner only). It is shown once, lasts 30 days, and stops working at once when revoked or when the owner's account changes. Send it as `Authorization: Bearer <key>`.

## Read

`GET /api/balm/agent/context` returns settings, staff names, services, practitioner hours, upcoming and recent appointments (with client names), invoices and drafts. It never includes treatment notes or intake answers. Each read adds an `agent.context` row to the access audit of every client it names.

`GET /api/balm/commands` lists the preparations and the approvals that answer them.

## Prepare

`POST /api/balm/agent/command` with a JSON body `{"name": "...", "input": {...}}`:

| Command | Input | Result | A person approves with |
| --- | --- | --- | --- |
| `invoice.prepare` | `appointmentId`; optional `amountCents` (integer AUD cents; default is the service price) | A draft invoice freezing the clinic, client, practitioner, service, date and amount. The appointment must be marked attended and have no live invoice. | `invoice.approve` (owner or reception), which numbers it and fixes its downloadable bytes. It is refused if any frozen fact has changed. |
| `reminder.prepare` | `appointmentId` | The exact reminder text (to, subject, body) for an upcoming booked appointment whose client has an email. | `reminder.approve` (owner or reception). The approved text downloads from `/api/balm/reminders/<id>.txt`; Balm sends nothing. Refused if the appointment changed. |
| `intake.prepare` | `title`; `questions`: 1–40 of `{id, label, type: short\|long\|yes\|date, required}` | A draft intake form version. | `intake.publish` (owner). It becomes the current version for new intake links. |

Any other command through the agent door returns 403. The same command names, plus the approvals and every staff command, are available to signed-in people at `POST /api/balm/command` with their session cookie and a same-origin `Origin` header.

## Errors

Errors return `{"error": "...", "code": "..."}` with 400 (invalid input), 401 (key missing, expired or revoked), 403 (not allowed for this actor), 404 (not found or not visible), 409 (changed, already decided or conflicting) or 429.
