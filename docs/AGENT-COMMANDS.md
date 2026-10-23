An agent key lets an assistant read the clinic's working state and prepare work. A signed-in person approves every preparation; the approval is recorded with the SHA-256 of the exact content approved.

Create a key in **Agent access** (owner only). It is shown once, lasts 30 days, and stops working at once when revoked or when the owner's account changes. Send it as `Authorization: Bearer <key>`.

## Read

`GET /api/balm/agent/context` returns settings, staff names, services, practitioner hours, upcoming and recent appointments (with client names), invoices and drafts. It never includes treatment notes or intake answers. Each read adds an `agent.context` row to the access audit of every client it names.

`GET /api/balm/commands` lists the preparations and the approvals that answer them.

## Prepare

`POST /api/balm/agent/command` with a JSON body `{"name": "...", "input": {...}}`:

| Command | Input | Result | A person approves with |
| --- | --- | --- | --- |
| `invoice.prepare` | `appointmentId`; optional `amountCents` (integer cents; default is the service price) | A draft invoice freezing the clinic, client, practitioner, service, date and amount. The appointment must be marked attended and have no live invoice. | `invoice.approve` (owner or reception), which numbers it and fixes its downloadable bytes. It is refused if any frozen fact has changed. |
| `reminder.prepare` | `appointmentId` | The exact reminder text (to, subject, body) for an upcoming booked appointment whose client has an email. | `reminder.approve` (owner or reception). The approved text downloads from `/api/balm/reminders/<id>.txt`; Balm does not send this text (automatic visit reminders, set on **Clinic**, are emailed by Balm itself). Refused if the appointment changed. |
| `intake.prepare` | `title`; `questions`: 1–40 of `{id, label, type: short\|long\|yes\|date, required}` | A draft intake form version. | `intake.publish` (owner). It becomes the current version for new intake links. |

Any other command through the agent door returns 403. The same command names, plus the approvals and every staff command, are available to signed-in people at `POST /api/balm/command` with their session cookie and a same-origin `Origin` header.

## Errors

Errors return `{"error": "...", "code": "..."}` with 400 (invalid input), 401 (key missing, expired or revoked), 403 (not allowed for this actor), 404 (not found or not visible), 409 (changed, already decided or conflicting) or 429.


## Scoped keys and small read doors

The owner chooses permissions under Agent access. The default UI choice reads only the schedule. For custom combinations, native `agent.create` accepts `scopes` as an array of the names below (or a space-separated string). Unknown or empty lists are refused. Existing keys and older callers omitting `scopes` retain the original assistant workspace and three preparation permissions; they do not gain any new read door. Revoke and replace them to narrow access. Keys remain bound to the live owner and cannot read clinical notes, intake answers or record exports, approve work or send webhooks.

| Permission | Public door |
| --- | --- |
| `appointments.read` | `GET /api/balm/agent/appointments`: visit IDs, patient IDs, practitioner and service IDs, times and status |
| `patients.read` | `GET /api/balm/agent/patients`: patient ID, name, date of birth, email and phone |
| `charges.read` | `GET /api/balm/agent/charges`: invoice IDs, patient and visit IDs, number, status and cents |
| `payments.read` | `GET /api/balm/agent/payments`: recorded invoice payments and payer takebacks, successful card receipts and posted external account movements, with kind, cents and dates |
| `context.read` | The original `GET /api/balm/agent/context` workspace described above |
| `invoice.prepare`, `reminder.prepare`, `intake.prepare` | Only the named preparation at `POST /api/balm/agent/command` |

Read responses contain `records`, `limit` (100 by default, at most 300) and `nextCursor`. Send `?limit=100&after=<nextCursor>` until `nextCursor` is null. Records are ordered by their stable opaque ID. The payment feed emits a card receipt or external account movement once, excluding duplicate invoice allocations; signed payer takebacks and account adjustment or write-off kinds remain explicitly labeled. Keys keep the existing prepare-only write boundary. Each listed patient is audited; revocation and the key's scope are checked again in the D1 transaction. An API key never authenticates the native `/api/balm/command` door.

## Explicit booking webhooks

Under Agent access the owner adds a public HTTPS destination and records consent. Its random signing secret is shown once and sealed at rest. Copy it directly into the receiving tool's secret manager; never put it in logs, source or evidence. New bookings create durable events. The owner chooses a destination and event and explicitly approves **Send approved booking notification**. There is no automatic sending. RER Managed sends are unavailable.

The exact JSON body is `{id,type:"appointment.booked",createdAt,appointmentId}` with opaque IDs and no clinical or contact text. `Balm-Signature` contains `t=<Unix seconds>,v1=<hex HMAC-SHA256>`. Verify the HMAC over the exact UTF-8 bytes of `t + "." + body`, compare in constant time, reject timestamps outside five minutes, and deduplicate by event ID. `Idempotency-Key` identifies the one durable attempt. A 2xx means receiving-server acceptance only. Redirects are refused. A redirect or 4xx is `refused`; a 5xx, timeout or network exception is `uncertain`; a pending or uncertain attempt is never resent automatically. Consent revocation and live owner authority are checked before sending. Revoked hooks and events from before consent cannot be sent.

Native commands: `integration.hook.create` (`url`, `consent:true`), `integration.hook.revoke` (`id`), `integration.hook.deliver` (`hookId`, `eventId`, `confirm:true`). Keys cannot call these. Restores exclude hook credentials and require a new destination consent. Delivery history stays with the patient and participates in approved retention destruction.

## Reviewed record exports

Patients request a record under their portal's **Your patient record** panel. The owner sees the 30-day deadline on the schedule, prepares a fixed package, reviews both originals and explicitly releases the digest. The patient then downloads the fixed PDF and FHIR R4 JSON from the same portal session. Every preparation, release and download is audited. There is no clinical export scope for API and agent keys.

The partial exporter produces US Core 6.1.0 Patient and clinical DocumentReference resources for notes, revisions and addenda, intake, visits, measures, programs, alerts, imported notes, plans, diagnoses and episodes. It also includes authorizations, claim-level remittances, coverage, billing facts, messages, pain and adherence, profile submissions and available issued statement, estimate and invoice and chart, consent, identity, insurance, message and exercise originals. Patient, recorded visit diagnoses, attended visits, practitioner names and clinic identity additionally use the corresponding US Core profiles. Completion status, family-name components and organization activity are never guessed; missing facts are explicitly unknown. Credential and link fields are excluded; professional signer credentials are kept. Both formats state omissions. Partial deliveries remain visible on the owner queue and do not establish complete fulfillment. The PDF renders text and describes attached originals. Shared multi-patient transport batches, remaining original categories, complete structured clinical-resource mappings and complete terminology-validated interoperability remain pending. Independent offline HL7 validation of a synthetic record has no errors, with one encounter-type code warning; full terminology validation remains unavailable. The clinic must continue its existing complete-record process. Record packages travel in archives and are destroyed only by the existing digest-approved retention process.


## Guardian and patient profile defaults

The owner grants a parent or legal guardian access on a minor's chart only after recording a verification of authority and confidential-care restrictions. A separate guardian email signs in through the same one-use email-link form. The guardian explicitly selects among the granted children; every request checks the current grant, selected child, patient version and age under 18. Shared patient email or an intake signature alone never grants access. Revoking a grant ends that guardian's sessions and their opened payment links. Restores keep the audited grants but exclude links and sessions. Ct approval of these defaults and fuller confidential-minor handling remain pending.

The portal accepts contact and insurance updates for clinic review. It keeps an immutable submitted payload and audit entry, shows the update in the chart, and never changes a sign-in address or verified payer or claim automatically. The owner applies the exact digest-reviewed submission only after verifying identity and the new contact or complete insurance facts. Client-version changes refuse stale proposals. Contact application revokes patient or guardian sessions and private payment links; coverage application resets eligibility without sending a claim or changing issued documents. SMS sign-in uses the existing configured Twilio adapter: five-minute one-use six-digit codes, at most five wrong attempts, salted code hashes, generic responses, unique live patient phone and the portal's existing address and patient quotas. Shared numbers grant nothing. Live US sender proof is not held.
