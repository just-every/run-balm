Balm turns signed visits into insurance claims, checks each claim before it leaves, and posts what the payer pays or denies to the visit and the patient’s balance. This page walks the owner through setting it up on the **Insurance** page, from nothing to a paid claim.

## What you need

Billing insurance takes four things. The first three you can fill in today; the fourth is needed only to send claims electronically.

1. **Your practice’s billing details.** Your billing NPI, federal tax ID (EIN), billing address and the person payers call about a claim.
2. **The payers you bill.** For each insurance company: its payer ID, how it counts timed units, and what you charge it for each CPT code (your fee schedule).
3. **Each practitioner’s enrollment.** Which practitioners each payer has accepted to treat its members, with their taxonomy code.
4. **A clearinghouse account (only for electronic sending).** A clearinghouse, such as Claim.MD or Availity, passes claim files and payer answers between you and insurance companies. Signing up means an application, a business associate agreement (BAA) because claims carry health information, and enrolling your practice with each payer through the clearinghouse. The clearinghouse then tests a few claims with you before you send for real.

## What works without a clearinghouse

- **Eligibility by hand.** Call the payer’s provider line or look the member up on its website, then open the patient’s file and, under **Coverage and authorized visits**, choose **Record an eligibility check made by phone or website**. Record whether coverage is active, the copay if they told you, and who you spoke to with the call reference. This counts as the eligibility check for the patient’s case.
- **Claims as files.** Balm checks each claim and builds a standard 837P claim file you download from the Insurance page and upload to your clearinghouse or the payer’s own portal.
- **Payer files.** The payer answers with files your clearinghouse or the payer’s portal gives you. Upload them in Balm: an **835** (payments and denials) on the Insurance page or the Cases page, a **277CA** (claim received or rejected) on the same pages, and a **271** (eligibility answer) in the patient’s file.

What waits on a clearinghouse connection: Balm sending claims and eligibility checks for you. You still upload the payer’s answers.

## Step 1: Practice billing details

Open **Insurance → Insurance setup → 1. Practice billing details**. Every field says where to find its value.

| Field | What it is and where to find it |
|---|---|
| Billing NPI | Your practice’s 10-digit National Provider Identifier. Look it up by name at [npiregistry.cms.hhs.gov](https://npiregistry.cms.hhs.gov). A solo practitioner who bills under their own name uses their own NPI. |
| Federal tax ID (EIN) | The 9 digits on your IRS EIN letter (CP 575), like 12-3456789. Your accountant has it. |
| Billing street address, city, state, ZIP | Where payers send letters and checks: a street address, not a PO box. |
| Billing contact and phone | The person a payer calls about a claim. |
| Send claims electronically | Leave off until a clearinghouse has enrolled you and finished testing. Turning it on marks files for production and requires the two IDs below. |
| Clearinghouse submitter ID | Optional until electronic sending is on. Your clearinghouse gives it to you when it sets up your account. Until then, claim files name your practice by its tax ID. |

If a value is missing or in the wrong shape, Balm says which field and what it expects.

## Step 2: Payers and your fee schedule

Open **2. Payers you bill and your fee schedule → Add a payer**.

| Field | What it is and where to find it |
|---|---|
| Payer name | The insurance company as the patient’s card shows it, like UnitedHealthcare. |
| Payer ID | The payer’s electronic ID, usually 5 characters (UnitedHealthcare is 87726). It is on the back of most insurance cards, in your clearinghouse’s payer list, or the payer’s provider line can tell you. |
| How this payer counts timed units | The CMS 8-minute rule (Medicare and most plans) adds up all timed minutes; the AMA rule counts each code on its own. Your contract or the payer’s provider manual says which. If unsure, choose CMS. |
| Fee schedule | What you charge this payer per unit of each CPT code, one per line: `97110 65.00`. Claims charge these amounts. |
| This payer is Medicare | Medicare uses the CMS rule and the yearly KX threshold (below). |
| Claims need the referring provider | Tick when this payer refuses claims without the referring physician’s name and NPI. |
| Interchange receiver ID | Optional until electronic sending is on. Your clearinghouse’s payer list or companion guide gives it. Until then claim files name the payer by its payer ID. |

To change a payer later, open **Edit (payer name)** in the same list. Adding a payer whose payer ID is already listed is refused with the payer’s name, so you edit the one you have.

**Invoices and the fee schedule agree.** A claim must charge the same total as the visit’s approved invoice. When you prepare an invoice for a patient with insurance and leave the amount blank, Balm uses the payer’s fee schedule for the signed note’s CPT units, and the form shows that amount. A typed amount is used as typed.

## Step 3: Provider enrollment

Open **3. Provider enrollment**. For each payer and practitioner, record the practitioner’s **taxonomy code**: the 10-character specialty code on their NPI Registry record (225100000X physical therapist, 225X00000X occupational therapist, 235Z00000X speech-language pathologist). Untick **The payer has enrolled this practitioner** while the payer is still credentialing them.

Each practitioner also needs their own 10-digit NPI (Clinic → Billing identifiers) and a first and last name on the staff list. If you treat clients yourself, enter your own first and last name in **Clinic → You**; a local install starts by calling you “Owner”, and a claim with a one-word name is held.

## Step 4: From a signed visit to a claim

1. Mark the visit attended, sign its note with the CPT minutes, and add the visit’s ICD-10 codes (patient file → Visit codes).
2. Prepare and approve the visit’s invoice.
3. In the patient file, open **Insurance claims → Prepare a claim from a signed visit**, or approve **Send the claim** on the patient’s case.

Balm checks the claim before it can go in a claim file. A claim that fails a check is **held**: each reason names what is wrong and links to where you fix it (the staff name, the payer’s fee schedule, the invoice, billing details, enrollment, the visit codes). Fix each one, then press **Check the claim again** on the claim.

If the invoice amount is what is wrong, open the invoice and choose **Void this invoice**. A held claim on that invoice is withdrawn with it, so you can prepare the invoice again (it then uses the fee schedule) and prepare the claim again. An invoice whose claim already went into a claim file, or that has payments, cannot be voided; correct the claim instead.

## Step 5: Claim files and the payer’s answer

On the Insurance page, **Build a claim file** gathers ready claims for one payer into one 837P file. Download it and upload it to your clearinghouse or the payer’s portal. With electronic sending connected, **Send through the clearinghouse** does that for you.

The payer answers in two files, which your clearinghouse or the payer’s portal gives you:

- A **277CA** says the claim was received, accepted for review or rejected. It is not a payment.
- An **835** (also called an ERA, an electronic remittance) says what was paid, what the contract wrote off, what the patient owes, and what was denied with the payer’s reason codes. Upload it on the Insurance page or the Cases page. The whole file must balance before anything posts, and the same file cannot post twice.

Posting an 835 moves each claim to **paid** or **denied** and moves the patient’s case on. Payer payments and contractual adjustments reduce the visit’s invoice; the patient’s share stays due.

## Denials

A denied or rejected claim keeps the payer’s reason code with a plain-language reason and the next step. Correct and resubmit when the claim was wrong; draft an appeal when the record supports payment. Appeal letters are drafts for a person to review and send. Earlier attempts stay on record.

Balm handles positive primary claim payments. Reversals, provider-level adjustments, secondary or tertiary coordination and unmatched claims are refused by name so you can reconcile them by hand.

## Medicare therapy rules

Annual CMS amounts live in **Insurance → Annual Medicare therapy settings**, separately for each service year and therapy accumulator, with effective dates, publication date and source. The 2026 settings use a **$2,480 KX threshold** for PT and SLP combined, a separate **$2,480 OT threshold**, and **$3,000 targeted medical review thresholds** for those two accumulators. Unknown years hold claims until the owner records the published settings. [CMS 2026 transmittal](https://www.cms.gov/medicare/regulations-guidance/transmittals/2025-transmittals/r13437cp), [CMS therapy rules](https://www.cms.gov/medicare/coding-billing/therapy-services).

In the patient file record recognized expenses from other providers, excluding claims already tracked in Balm, with the source and date. Batched local visits initially accrue their configured allowed fees; an ERA replaces that estimate with payer payment plus patient responsibility. **Reconcile Medicare-recognized expense** on a claim replaces the local estimate/adjudication with the amount from Medicare after applicable reductions. Corrections count each encounter once. Each calendar year and OT accumulator remain separate.

Above the KX threshold, covered services stay held until the treating clinician records the medical necessity supported by the record. Only then does Balm apply KX. Exceeding the targeted-review amount flags the claim and queue for record readiness; it does not mean the claim has been selected for review. Batches recheck annual settings, external expenses and clinical facts, including multiple visits crossing the threshold together. [CMS KX documentation requirements](https://www.cms.gov/data-research/monitoring-programs/medicare-fee-service-compliance-programs/medicare-fee-service-recovery-audit-program/approved-rac-topics/0228-therapy-claims-billed-kx-modifier-medical-necessity-documentation-requirements).

A clinician records each procedure’s coverage determination and assistant units from the claim. Expected medical-necessity denials use **GA** with a signed **CMS-R-131** and option 1; without that notice they use **GZ**. Statutory exclusions use **GY**, plus **GX** when a voluntary notice is captured. Capture the signed PDF/image, notifier, beneficiary signature, issuance/signing dates, services, specific denial reason, estimated cost and the beneficiary’s actual option. Options 2 and 3 prevent Medicare submission. The signed original remains fixed, can be downloaded by the owner or treating clinician and travels in the archive. Maintenance therapy does not automatically imply noncoverage; the clinician determines whether skilled services are reasonable and necessary. [Official CMS-R-131 and instructions](https://www.cms.gov/medicare/forms-notices/beneficiary-notices-initiative/ffs-abn), [CMS modifier guidance](https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleId=57067).

The clinician records the number of units requiring **CQ** for PTA or **CO** for OTA services, with their assessment of independent minutes, the 10% de minimis rule and final-unit exceptions. Joint time counts as therapist time. Balm splits mixed therapist/assistant units into distinct claim lines, preserving the total charge. Speech services cannot use these modifiers. Amounts remain billed charges; Medicare’s 85% assistant payment is adjudicated by the payer and recognized expenses are reconciled from its record. [CMS assistant billing rules and examples](https://www.cms.gov/medicare/coding-billing/therapy-services/billing-examples-using-cq-co-modifiers-services-furnished-whole-or-part-ptas-otas).

## Insurance collected during intake

Fill in practice billing details and the payers before asking patients for insurance. The intake link then asks for primary and secondary coverage, the subscriber and their relationship to the patient, card front and back photos and a photo ID (a parent’s or guardian’s for a child). Each image is JPEG, PNG or WebP up to 1.9 MB.

Submitting creates the patient’s policies and a prepared 270 eligibility inquiry for each. Staff verify the card details on the file; a correction also updates the policy and replaces an outstanding inquiry. Card and ID downloads require patient-file access and are recorded in the file’s access audit.

## For your clearinghouse or IT person

Balm writes ANSI X12 5010 files: 270/271 eligibility (005010X279A1), 837P professional claims (005010X222A1), 277CA acknowledgments (005010X214) and 835 remittances (005010X221A1). Without a submitter ID the interchange sender is the practice’s EIN (ISA qualifier 30); without a receiver ID the receiver is the payer ID. Payer companion guides and the clearinghouse’s enrollment testing still apply.

A self-hosted Balm connects to a clearinghouse through the practice’s own HTTPS adapter, set as the private deployment settings `BALM_INSURANCE_ADAPTER_URL` and `BALM_INSURANCE_ADAPTER_TOKEN`. Balm sends one authenticated POST with the transaction kind, a stable request ID, the X12 body and its SHA-256 digest. The adapter submits that exact body, deduplicates by the request ID, and returns its durable submission reference only after the clearinghouse accepts the file. A lost response is an uncertain submission: reconcile with the clearinghouse before sending again. RER Managed hosting cannot reach a clearinghouse yet.

### Fixed timed-unit thresholds

If a payer contract uses a fixed number of minutes per unit, choose **Fixed minutes per unit for each code** in its payer form and enter the positive whole-minute threshold. Balm counts only complete thresholds for each timed CPT separately; it never pools those minutes. Untimed codes still bill one unit. For example, at 15 minutes per unit, 8 minutes of 97110 and 8 of 97140 bill no timed units; the claim scrubber names both codes. Thirty minutes and 29 minutes bill two units and one unit.

The note shows the current payer calculation. An approved invoice and its superbill keep the method, threshold and units used when issued, even after a payer edit. Authorization usage and daily close use the same calculation. Dated payer-setting history is not implemented yet. Medicare continues to require CMS total-time units.


## Dated contracts and provider licenses

In Insurance setup, open **Dated plans and fee schedules**. Record the contract source, effective date, complete CPT prices and timed-unit method. Copy a plan name exactly from the patient’s policy, or leave it blank for all plans. A plan revision takes priority over the payer baseline. Within each scope, contracted schedules take priority over standard, then the latest effective date applies. Existing payer setup remains the baseline until a dated revision covers the service. Record a later revision when the contract changes; issued invoices retain their original pricing and unit basis.

**Provider licenses** records the practitioner, state, number, valid dates and source. Only the owner records and reads these facts. Balm labels them as owner-recorded; it does not check a licensing board.

## Reviewed pre-cutover insurance A/R

The owner can carry **reviewed conversion CSVs** of legacy claims through the command API. This is a separate A/R ledger, not a native WebPT/Jane package importer, and does not create duplicate Balm invoices. Keep the incumbent's original aging report. Match its patients to Balm patient IDs and its carriers to Balm payer IDs before import. Maximum 100 claims per reviewed file. Exact UTF-8 CSV headers:

```csv
Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status
```

Amounts are positive US dollars (balance may be zero), service dates are ISO dates, and status is `open`, `denied` or `rejected`. `Payer control` may be blank until assigned. Retain the incumbent's source claim number and patient control number unchanged. Call `insurance.runout.preview` with `source` (the stable source-system name) and `csv`; review its records, count and balance total. Call `insurance.runout.apply` with the same inputs, the returned `fingerprint` and `expectedBalanceCents` from the source aging. A changed original or an incorrect control total is refused. Repeating an unchanged source claim adds nothing, including after its balance changes through a payment.

An owner imports a mixed 835 using the existing payer-file upload. Balm checks its own claim IDs first, then unambiguous payer-scoped migrated patient/payer control numbers, then a uniquely matching patient name, service date (DTM 232/472) and billed amount. Ambiguous or unknown claims remain in **Insurance → Pre-cutover insurance A/R → Unmatched remittances**, with the complete parsed original and payment held in suspense. Every payment contributes to the deposit. The owner may explicitly match a queued line to a reviewed migrated claim; payer, billed amount, remaining balance and once-only posting are checked again. Unsupported OA/PI adjustments and overpayments refuse the whole file. Patient responsibility remains on the legacy balance for review; it never creates an automatic patient statement.

The run-out report retains imported, paid, adjusted and remaining amounts by payer and age. Closing requires all migrated balances and every unmatched line to be cleared. For a denied or rejected legacy claim, complete its original historical visit through Balm’s normal attended visit, signed note, diagnosis, policy and approved-invoice doors. `insurance.runout.correct` takes the migrated `id`, a ready `claimId` for the same patient, payer, service date and billed amount, and explicit `attest: true` after checking the original signed charge records. It keeps frequency 7 and the original payer control number. Any amount already settled before cutover is a labelled opening credit, not a remittance or payment; the report follows the single transferred receivable through subsequent native adjudication. Build and submit its 837P through the existing claim-file door. A network-edge gateway receipt proves local resubmission; live payer transport remains INS-006. Paper EOBs use the existing payer-batch commands: provide the legacy patient-control number as `claimId`; unknown controls wait in the same suspense queue. The original scanned EOB and a balanced complete check are required before posting, and adding a legacy/unknown line withdraws the prior scan attestation. Mixed legacy paper originals and run-out data are owner-only. Close only reconciled run-out; explicitly reopen it to review later receipts. The conservative default is owner-only access, no automatic outbound or destructive action; retention destruction waits while any unmatched remittance still needs identity review.
