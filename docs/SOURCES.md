# Source adaptation

Balm starts from Base's committed foundation at `ada9f574d8a7247edc3a1180b593ad182b1fbb37`, generated as family `clinic`, edition `balm`, then converted to package mode on `@runeditrun/rer@0.2.22`. Base runtime, native authentication, theme, portability and import-kit keep their attribution in their source. MIT license retained. No sibling repository was edited.

| Balm part | Adapted from |
| --- | --- |
| Availability engine (`src/balm/availability`) | Dial's engine, windows and time-zone arithmetic, copied from `just-every/run-dial@66d22da8d5c4d7fe2c368ae8d21a2615875abfe4` `src/core/features/availability` |
| Appointment reminders | Dial's reminder commands, same commit; Balm prepares text for approval instead of scheduling mail |
| Client-file access, guarded batches and audit | Satchel's matter membership and `atomic()`/`audit()`, `just-every/run-satchel@2d460e4` `src/satchel/{matters,model}.ts` |
| Reviewed invoices | Satchel's reviewed billing, same commit, `src/satchel/billing.ts` |
| Note revisions and audited downloads | Willow's immutable document revisions, `just-every/run-willow@5b116dba308ab2bad264a7662705c87b29304b1e` `src/willow/documents.ts` |
| Intake answers bound to a form version | Pencil's responses, `just-every/run-pencil@5469766707a97e3fefd7b81057b8b26ab330923a` `src/core/features/responses/service.ts` |
| Prepare/approve fence | Nectar's prepared changes, `just-every/run-nectar@7f38865a4d41e13e24c1cb16a07ae489c9184cea` |
| Invitations, agent keys, server-rendered screens, move-in transport, test harness and archive test | Strap, `just-every/run-strap@92c3892a6c8dfee44ee2a8152a365f11372faaaf` |

Import-kit and its D1 transport are copied unchanged from Base; `migrations/core/0016_import_kit.sql` is its exported D1 schema in initializer order.
