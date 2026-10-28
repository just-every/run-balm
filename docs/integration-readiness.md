# Integration readiness

Open **Clinic → Integration readiness** as the owner. Record the practice's named privacy and security officers, the security risk analysis worksheet or its controlled document reference and review date, and the reviewed encryption controls for stored data and transport. Keep the worksheet and signed agreements in practice custody.

For every configured subprocessor, use **Record signed BAA** to name the provider and covered account, covered plan or edition, signed date and original agreement reference. Confirm that the signed agreement actually covers the configured account and services. Twilio requires its Security or Enterprise edition. The checklist also lists mail, fax, clearinghouse, video, scribe model, backups and hosting, including services not yet connected. The recorded plan is an owner-entered fact; Balm does not validate the legal agreement or a provider's eligibility.

SMS enablement and sends, patient mail, the scribe model, clearinghouse sends and backup enablement and runs check the register on the server. A missing or revoked BAA blocks the corresponding integration. Revoking a BAA preserves its history and blocks future attempts; it cannot recall earlier provider requests. Recording an agreement does not send data, configure credentials or create patient consent. Staff sign-in remains available so the owner can remedy missing records. Fax and video transport remain unbuilt.

**Export readiness record** downloads the checklist, review and BAA register as JSON. These practice records and their audit events travel in clinic archives. Secrets are not part of the readiness export. A restored clinic still follows the existing credential reconnection requirements.

A passing integration check means the owner recorded the required facts and agreements. It does not establish HIPAA compliance, eligible hosting or permission to enter real patient data. HIPAA-005 retains the hosting BAA, real-patient gate and required live backup receipts, and the practice must complete its privacy review.

Hosting evidence and the separate audited patient-mode switch are under **Clinic → Hosting and patient mode**. See [Hosting and patient mode](./hosting-readiness.md). Restoring an archive retains the evidence but starts with patient creation blocked; a fresh qualification and explicit activation are required.
