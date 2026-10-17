Balm keeps insurance policies, eligibility responses, authorizations, professional claims, acknowledgments and remittances with the patient’s file. Open **Insurance** for the practice queue; open a **Client** for their coverage and authorized visits.

## Connect a clearinghouse

**Claim.MD / Availity connection pending.** No clearinghouse account is included. The practice owner needs an account and business associate agreement, payer and provider enrollment, approved submitter/receiver IDs, sandbox credentials and payer companion-guide testing before live submission. A generated X12 file is not proof that a payer will accept or pay it.

You can export a 270 eligibility inquiry or 837P claim batch, submit it through your enrolled clearinghouse, then import its 271, 277CA or 835 response. Every import is checked before its records post. Balm never labels an exported file as received by a payer. Eligibility benefits are a dated payer response, not a guarantee of payment.

For automatic transport on a self-hosted install, connect the practice’s own HTTPS adapter using `BALM_INSURANCE_ADAPTER_URL` and `BALM_INSURANCE_ADAPTER_TOKEN` as private deployment settings. The adapter contract is described below. Leave both unset until an enrolled clearinghouse is available. RER Managed has no provider egress relay yet: insurance provider calls say **not available yet**.

## Policies, benefits and visits

Add a payer, the rendering practitioner’s enrollment and fee schedule in Insurance. In the patient file, enter the member, subscriber and address exactly as the payer knows them. Prepare a 270 for the service date, download it and import the corresponding 271. The chart shows active/inactive coverage, copays, coinsurance and visit limits by benefit/service type. Unknown and unsupported benefit details remain visible; do not assume different service types share a visit accumulator.

Authorizations have a number, start, expiry, visit count and optional practitioner. Attended visits use the count; booked visits reserve future capacity. Canceled and no-show visits do not count as care given. The chart shows used and remaining visits. Booking shows low/expired warnings for the staff to review; a block policy requires a current authorization.

## From a signed note to a claim

Mark the visit attended, review and sign its note, add its ICD-10 codes, then prepare and approve the invoice. Claims use the signed note’s CPT minutes and units; the payer’s configured timed-unit method must be supported. The scrubber names missing billing identifiers, demographics, enrollment, diagnoses, authorization, signed documentation and fee details. Correct the source record and scrub again before batching.

Select ready claims for one payer to build an 837P batch. Download the fixed file or submit it through the configured adapter. A 277CA records receipt, acceptance into adjudication or rejection. Acceptance is never shown as payment. A denied/rejected claim can be corrected into a new claim; a payer-assigned control number is needed for a replacement claim. Earlier attempts and their events stay on record.

## ERA and denials

Import an 835 from the selected payer. Balm balances its charges, payments, contractual adjustments and patient responsibility before posting the batch atomically. Payments post to each visit’s approved invoice. Contractual adjustments reduce the balance separately from cash; patient responsibility remains due. Pending and denied claims stay in insurance receivables and are excluded from patient pay links until adjudication assigns the patient share. The same file or payment trace cannot post twice.

The current import handles supported positive primary professional remittances. Reversals, provider-level adjustments (PLB), unmatched claims and unsupported adjustment groups are refused by name for manual reconciliation. No line is silently assigned to a patient. Split remittances, secondary/tertiary coordination and historical A/R run-out are not yet supported.

The denial queue keeps the original CARC/RARC or acknowledgment code, a plain-language reason and a next step. Correct and resubmit when the claim is wrong; draft an appeal when the record supports payment. Appeal letters are drafts for a person to review and send. Unknown codes remain visible and require the payer’s explanation.

## Medicare KX

The 2026 KX threshold is **$2,480** for PT and SLP combined, with a separate **$2,480** OT accumulator. Enter the beneficiary’s expenses outside this clinic and record the source/year. Local fee-schedule amounts are an estimate of incurred expenses; reconcile them with Medicare-recognized amounts. Balm cannot know care given by other providers without that information. Crossing the threshold adds KX only with recorded medical-necessity support. This is a documentation threshold, not a hard visit cap.

Reference: [CMS therapy services](https://www.cms.gov/medicare/coding-billing/therapy-services); [X12 service type codes](https://x12.org/codes/service-type-codes). X12 versions: 270/271 005010X279A1, 837P 005010X222A1, 835 005010X221A1, 277CA 005010X214. Payer companion guides and enrollment testing remain required.

## Adapter contract

Balm sends one authenticated HTTPS POST containing the transaction kind, stable batch/request ID, X12 body and SHA-256 digest. The practice-operated adapter submits that exact body to its enrolled clearinghouse. It must deduplicate by the stable ID and return its durable submission reference. Do not acknowledge before the clearinghouse accepts transport. A lost response is an uncertain submission: reconcile with the clearinghouse before any retry. Credentials and transaction payloads must never appear in access logs.

Recorded synthetic X12 fixtures live only in the test suite. The application has no fixture mode and fabricates no payer responses.

## Insurance collected during intake

Configure practice billing and submitter details and the payers on the Insurance page before asking patients for insurance. The intake link then offers primary and secondary coverage, subscriber identity and relationship, card front/back photos and photo ID (a parent’s or guardian’s ID for a child). Each image accepts JPEG, PNG or WebP up to 1.9 MB. Required claim fields and both card sides are checked before the intake is saved.

Submitting creates the native policies and a prepared X12 270 request for each policy in the same transaction as the intake. The patient file shows the requests for export or submission through the configured adapter; preparing a request does not confirm coverage. Staff verify card details on the file. A correction also updates the native policy, leaves the original images fixed, and replaces an outstanding inquiry so its old response cannot overwrite corrected coverage. Photo-ID and card downloads require patient-file access and are audited.
