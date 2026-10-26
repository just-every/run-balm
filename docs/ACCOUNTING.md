# Accounting handoff

The owner opens **Clinic → Accounting handoff**, chooses the QuickBooks environment and connects an already authorized company grant. Balm verifies the company through Intuit, seals the credentials with the installation key, and saves each rotated refresh token before another provider request. Credentials never appear in working state or clinic archives. A restored clinic must reconnect explicitly.

Review every USD control account before preparing a day. Customer-specific Accounts Receivable and Accounts Payable accounts require their own subledger and cannot be selected here. The handoff uses a receivable control account and separate reviewed mappings for income, card and ERA clearing, cash, other receipts, bank deposits, fees, adjustments, gift liabilities and tax liabilities. No account is selected automatically.

**Review day** freezes the source events, account mappings and exact journal. The owner must approve that journal before Balm sends it. Balm sends dates, amounts and money categories; patient names, local record identifiers, clinical fields and original payment references stay in the clinic. An agent key cannot connect, map or send.

Days use the clinic time zone. Charges enter on invoice approval; an approved invoice void contributes a separate reversal on its recorded void date. Card and ERA receipts, desk payments, adjustments and confirmed refunds use their recorded posting times. External credits enter once when posted, rather than again when allocated to invoices. Retail cash, gift liabilities, redemptions and tax follow the recorded sale. The patient form records cash, check or bank tender explicitly; older unclassified desk receipts stay in other payment clearing. Existing financial reports retain their service-date charge convention.

Processor deposits and fees come from owner-recorded allocated payout originals. They move recorded card clearing to bank and fee accounts. These originals do not establish a bank match or independent processor verification. Clinical and payer observations are never turned into new money movements.

Every send reserves its sources durably before contacting QuickBooks. The exact body and request identity survive a lost response. Resume reads a matching journal back first and validates every amount, account, posting direction and description. A recent unresolved send can reuse its saved request identity; an old uncertain send with no matching journal requires owner reconciliation. Changed or duplicate provider journals refuse further posting. An ordinary repeat reads the same entry and creates nothing new; later source events receive a separate journal.

Incomplete money originals, unreconciled remittance cash and run-out suspense without dated accounting resolution history refuse preparation. Balm never guesses missing historical dates or posts an apparently balanced replacement. Resolve the cited source before handing off the affected day.

The public commands are `accounting.connect`, `accounting.mapping`, `accounting.prepare`, `accounting.sync` and `accounting.disconnect` through the native command route. Disconnect removes local authorization and preserves financial journals. It does not claim to revoke the grant at Intuit.

Proof is the mixed-day journey in `tests/payments.test.mjs` named **reviewed QuickBooks journals reconcile a mixed payment day and resume lost responses without duplicates**, the native forms in `tests/accounting-browser.mjs`, and the held-grant sandbox journey in `tests/accounting-sandbox.mjs`. The existing archive journey named **retail and finance originals, paused entitlements and preparation authority survive a public CLI archive round trip** proves the restored connection is inactive.

The manual sandbox journey requires the named-key injector and `BALM_QBO_INGEST` pointing to the approved external token-persistence helper. It saves a changed grant immediately and emits financial observations with no credentials. `BALM_SANDBOX_OUTPUT` optionally selects the capture destination.
