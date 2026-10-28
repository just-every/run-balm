# Hosting and patient mode

New installations refuse patient creation until the owner explicitly selects a
mode in Clinic settings. Demo mode permits synthetic data only. Blocking patient
creation preserves existing records and access needed to remediate readiness.
A passed integration checklist or a generic hosting agreement never enables real
patients on its own.

For a Cloudflare deployment, configure the non-secret `BALM_HOSTING_PROFILE`
runtime binding with the actual account, deployment identifier and complete
service inventory. Its JSON shape is
`{"provider":"cloudflare","account":"account identifier","deployment":"deployment identifier","services":["workers","d1","r2"]}`.
Include every additional service in use. Workers, D1 and R2 are mandatory in this
runtime's inventory. An absent, invalid or incomplete inventory refuses real
activation. Editing this binding does not supply provider qualification.

The owner records the hosting BAA and the off-site backup BAA in Integration
readiness, retaining the originals in practice custody. In Hosting and patient
mode, record the exact provider, account and deployment, all deployed services,
the services explicitly covered by that hosting agreement, an eligibility
reference for each service, the deployment qualification reference, the actual
locked encrypted backup receipt and the successful restore drill receipt.
Eligibility evidence is a JSON object whose keys are the service names and whose
values reference the reviewed provider documentation. Cloudflare coverage that
omits R2 cannot qualify this stack.

These are owner-entered evidence references. Balm does not authenticate legal
documents or independently establish provider service eligibility. Synthetic
records establish neither qualification nor permission for real patient use.
No AWS deployment or HIPAA-eligible AWS stack is supplied by this implementation;
AWS evidence may be retained, but cannot activate this Cloudflare runtime.
The required actual AWS deployment, its recorded BAA, SSE-KMS S3 Object Lock
backup and restore drill, Cloudflare BAA including R2, locked R2 backup and drill,
and off-site storage BAAs still need real provider proof.

The owner separately enables real-patient mode against one matching record. The
switch is audited with its reason. Each new staff-created patient, public booking
and patient import, including resumed CSV batches and approved bundle cutovers,
rechecks current mode, deployment, service coverage, readiness, agreements,
qualification and owner authority in the same transaction as the patient write.
An incomplete or revoked prerequisite refuses before a booking payment
reservation is created. Correcting an existing patient's details is still
available. Restored hosting records and revocations are historical evidence;
archives exclude executable qualification and patient mode. A restored
installation starts blocked and needs fresh qualification and explicit activation.
