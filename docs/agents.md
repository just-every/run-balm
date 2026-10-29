<!-- Generated from agent-surface.json; checked against the live registry by rer verify. -->
## Therapy practice coordinator

This declared core slice supports clinic identity, service fees and duration, rooms and equipment, native staff jobs, intake preparation and publication, and configuration reads. The registry at /mcp is the runtime authority. It accepts MCP 2026-07-28 and 2025-11-25. Company policy governs each registered call; the sponsor's current native clinic role governs its service access. Most configuration jobs require the native owner role; the template catalogue retains native active-staff admission. Business admin status does not grant a clinic job.

| Tool | Possible classes | Scope | Clauses | Conformance steps |
| --- | --- | --- | --- | --- |
| `balm.workspace.snapshot` | standard | `context.read` | BALM-001 | `snapshot` |
| `balm.clinic.get` | standard, sensitive | `context.read` | SETUP-001, US-001 | `clinic`, `tax-read` |
| `balm.clinic.update` | standard, sensitive | `clinic.write` | SETUP-001, US-001 | `identity`, `tax-private`, `tax-clear` |
| `balm.services.list` | standard | `context.read` | SCHED-007 | `services` |
| `balm.services.save` | live, money | `services.write` | SETUP-001, SCHED-007, SCHED-010 | `new-service`, `duration` |
| `balm.facilities.list` | standard | `context.read` | SCHED-002, SCHED-007 | `facilities` |
| `balm.facilities.save` | live | `facilities.write` | SCHED-002, SCHED-007 | `room`, `equipment` |
| `balm.staff.list` | standard | `context.read` | BALM-001, ROLE-002 | `staff` |
| `balm.staff.update` | access | `staff.write` | BALM-001, ROLE-002 | `new-staff`, `narrow-staff` |
| `balm.forms.list` | standard | `context.read` | INTAKE-001, INTAKE-002 | `forms` |
| `balm.forms.prepare` | standard | `intake.prepare` | INTAKE-001, INTAKE-002 | `draft` |
| `balm.forms.publish` | live | `intake.publish` | INTAKE-001, INTAKE-002 | `publish` |
| `balm.templates.list` | standard | `context.read` | CHART-002 | `templates` |
| `balm.events.list` | standard | `events:read` | BASE-AGENT-010 | `events` |

## Records, identity and approvals

Resources: `balm://clinic/{id}`, `balm://service/{id}`, `balm://staff/{id}`, `balm://room/{id}`, `balm://equipment/{id}`, `balm://form/{id}`. Each reader rechecks native owner visibility; missing and restricted records are indistinguishable. Stored labels, questions and imported text are untrusted. No bearer or provider credential is returned. The witness masks an SSN; clinic identity reads classify an actual full SSN as sensitive. Setting a service fee adds money; changing only duration retains live. Staff changes compute the native subject and refuse self-widening.

Business owner_id and team id bind to native operator ids. Existing team people keep their clinic grants; a signed roster does not create shadow accounts. Unknown, inactive or natively inadmissible subjects cannot act. Original local preparation keys retain their original scopes and revocation checks. A failed recognizable Business token cannot become a local key. Native sessions and independent second-factor proof control the person-only /agents and approval pages. The agent prepares; actual reviewers are named separately in native activity. Autonomous policy invents no human approval.

## Boundaries

The declared capability set is tools, policy, pause, audit and idempotency. Base 0.2.86 still advertises its compulsory event/subscription surface and requires effect events in its harness; this seed adds no new native event family. Multi-sponsor verification, subscription delivery, event refresh and external mail families are undeclared. There is no provider spend registration or spend enforcement, and these tools contact no outbound provider.

Pinned Base also has no client-scoped retained-artifact redaction and atomic pending-execution/capture hook for Balm erasure. Native custody remains closed rather than claiming that patient deletion clears retained approvals or replay outcomes.

Patient/chart, appointment, ledger, payer, messaging, finance, backup and destruction adapters from ct's draft are not claimed by this configuration slice. Existing native clinical signatures, patient consent, independent proof, imports, devices, connectors, provider callbacks and installation operations keep their own doors. The legacy scoped preparation API retains its existing behavior; its complete policy migration is still owed. No target-only clinical or provider capability is registered.

The disposable journey uses the seed's real setup-token bootstrap, native authenticator enrollment and first-run confirmation. It exercises all declared tool/class pairs under autonomous and held policies, injection arguments, replay, pause and staff self-escalation. Browser proof uses the actual native pages at 1440 and 390. A failing or undeclared check is not acceptance.

Capacities are 600 requests per minute and 1 MiB per MCP request, not company volume policy. Native questions are bounded to 40, service durations and prices use native validation. Errors use named JSON codes and MCP `com.runeditrun/error` metadata; approvals bind exact summary hashes and native revisions. Undo is omitted because these jobs have no native reviewer reversal.
