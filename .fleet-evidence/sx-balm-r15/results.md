# sx-balm-r15 results

Baseline main: bdb5069dce8a476b7ffb5e21c84d4718db797e3a. Exact-SHA Verify 39404901152 and Run site 39404901141 completed/success.
seed.json description: 518 -> 496 characters, cap 500. Tightened introductory wording and physician-link wording only; all capability claims retained. Homepage unchanged.
CONTRACT.md honest payroll boundary now links Envelope, with no capability claim or clause status change.
Counts: 50/31/28 -> 50/31/28 (done/partial/missing). No clause marked DONE without complete acceptance.
No UI screens changed. No browser proof required for manifest/prose edits. Base copies and rer pin unchanged; import-door adoption not triggered.
No main push or deployment authorized in this cloud run; Mac lands after exact-SHA green.
The environment default pnpm 11 rejected the pre-existing SheetJS tarball lock entry; use repository/CI pnpm 10.12.4 without changing the lockfile.

Local validation: pinned pnpm 10.12.4 frozen install, typecheck and rer check --profile first-party passed. All 379 Status Evidence paths resolve. Manifest JSON parses and description length is 496 <= 500. No assertions weakened or added; no full local suite run per round-speed rule.

Publication preflight at 903c93c7ccad30af23aa9cadf8e7630ca6201edd: PASS, complete, 146 commits/trees and 2,398 blobs; zero findings, zero pre-existing findings, zero warnings. Initial missing-Gitleaks prerequisite resolved by installing checksum-verified Gitleaks 8.30.1. Final evidence commit will be rescanned before push; CI receipts for its exact SHA are returned in the final report.

Initial branch Verify 39436441924 completed/failure on 927ea7601f7be07c4e1cc6a63dfe2787a7eaa4f0. Only failing test: existing AGENT-003 charting journey, appointment.book returned 409 practitioner_already_booked at tests/charting.test.mjs:660. The fixture retimed visits to a fixed 10:00 Brisbane clock, colliding with its next recent public booking near midnight. Preserve each publicly booked slot’s distinct clinic time and duration when arranging elapsed treatment days. No application code or assertions changed. The named AGENT-003 public-door test passes on Node 22.20.0 after the fix. Clause AGENT-003 remains done -> done; all other statuses remain unchanged. Final exact-SHA CI is required after this fix.
