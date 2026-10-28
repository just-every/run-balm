Open **Move in** in the app. Download the report named below, upload the file unchanged, choose **Preview move-in**, and check the names and totals. Nothing is added until you approve the preview.

Balm accepts CSV and Excel patient lists, up to 20 MB per file and 50,000 records per upload. It processes large imports in smaller groups automatically. An import is saved together; a failed import adds nothing. Repeating unchanged files adds no duplicates. **Undo this move-in** removes that import together, unless someone has edited or used its records since.

## WebPT

For a patient list:

1. Open **Analytics → Management → Patient Lists**.
2. Set **View Data by** to **All**, and include the clinics and patient statuses you need.
3. Select the **Download** icon under the filters, then **CSV**.
4. Upload the downloaded file as the patient list in Balm.

Balm reads **Patient Name, Date of Birth, Phone and Email**. Names written as “Last, First” are split for your review. The other columns are listed as left out. WebPT’s **Patient Identification** describes the kind of identification and is not used as a permanent patient number. Without a patient number, Balm uses the name and email or birth date to recognize the same uploaded patient; a row without either is refused.

Without Analytics, open **Patient Manager → Display Patients → All Company Patients**. Set both patient and case status to **All**, select **Search → Export to Excel**, and upload that spreadsheet. Balm reads **Name (First), Name (Last), Patient ID, Date of Birth, Email**, the cell phone (or home phone when there is no cell-phone column), and primary insurance when its subscriber number is present. The preview flags patient numbers that appear rounded by a spreadsheet. WebPT does not publicly specify whether this download uses XLS or XLSX; Balm can read both.

For appointments:

1. Open **Analytics → Reports → Visits → Scheduled Visits**.
2. Choose the date range, one treating therapist and one appointment type.
3. Under **Options**, include **Patient ID**. Select **Export Data → CSV**.
4. Upload it with the patient list. In Balm, choose that therapist’s practitioner record and the matching service. Each upload uses one practitioner and service.

Balm reads **Patient Name, Appointment Date, Start Time, End Time, Visit Status, Treating Therapist and Appointment Type**. These reports use different patient identifiers, so Balm links a visit only when its full patient name identifies exactly one uploaded patient. An absent or duplicate name stops the import and names the affected row. Check every link in the preview. Times use the clinic’s time zone, including historical clock changes; an ambiguous or missing clock-change time is refused.

WebPT limits Scheduled Visits to three years. Confirmed or scheduled visits become booked; checked-in or checked-out visits become attended; canceled visits and no-shows keep those states. WebPT calls a visit with no recorded status **Other**. Balm keeps it booked and warns you to check past visits before billing; it does not assume attendance. A blank or unknown state stops the import. Overlapping visits remain in the preview and require your review.

Charts, balances, authorizations and complete insurance policies are not moved by these reports. WebPT’s full ZIP export does not contain scheduling or payment data, and its complete column descriptions are not publicly documented. Balm does not read that ZIP.

Sources: [WebPT Patient Lists fields](https://discover.webpt.com/docs/webpt-analytics-patient-lists.md), [CSV download](https://discover.webpt.com/v1/docs/webpt-analytics-analysis-grid-style-reports), [Excel patient list](https://discover.webpt.com/docs/webpt-emr-simple-patient-lists-email-and-exporting.md), [Scheduled Visits fields](https://discover.webpt.com/v1/docs/webpt-analytics-scheduled-visits), [full data export](https://discover.webpt.com/docs/webpt-emr-data-exports.md).

## SimplePractice

1. Sign in as the account owner or someone who can see the full client list.
2. Open **Analytics → Reports → Client details**.
3. Include all clinicians, client types and statuses you want to move.
4. Select **Export → CSV**. In the newer report layout, select **Manage report → Download CSV**. The Excel download also works.
5. Upload the unchanged download as Balm’s patient list.

Balm reads **Client, Email, Phone number, Primary insurance and Insurance ID** from the documented report. Check the first and last names in the preview, especially compound names. This report does not document birth dates or permanent client numbers. An email address is needed for a patient without either. Two rows identifying the same person stop the import. A policy without a member number is left out with a warning; the patient can still move in.

Appointments, balances, charts and restricted clients’ separated records are not included. The current appointment and billing reports do not have enough publicly documented information for Balm to import them safely. Keep a complete SimplePractice data export, including separated data, before closing your account. Balm does not unpack its ZIP or vCard files.

Sources: [Client details fields](https://support.simplepractice.com/hc/en-us/articles/13218379819661-Understanding-your-clients-and-appointments-reports), [report downloads](https://support.simplepractice.com/hc/en-us/articles/46494400564237-Exporting-your-reports), [complete export and separated data](https://support.simplepractice.com/hc/en-us/articles/207625506-Exporting-client-information-through-data-exports).

## Jane: direct import is not available yet

Jane documents **Reports → Patient List → ⋯ → Export to Excel or CSV → Download CSV File**, but its public guides do not show the complete columns of the downloaded file. We could not verify those columns or obtain a native sample. Balm cannot yet promise a safe import. Keep your download unchanged; do not spend time reshaping it for Balm.

A patient-list sample with fictional details, preserving Jane’s original headers, is needed before direct import can be supported. Appointment, insurance, balance and chart downloads are also unsupported. Jane’s accounts-receivable report does not subtract account credits, so its total cannot safely become each patient’s opening balance.

Sources: [Jane’s patient reports](https://jane.app/guide/patients-reports), [CSV download instructions](https://jane.app/guide/send-an-email-to-all-patients), [Excel download instructions](https://jane.app/guide/exporting-reports-and-customizing-them-in-excel), [accounts receivable](https://jane.app/guide/accounts-receivable-report).

## Cliniko

As a Cliniko administrator, open **Settings → Data & docs → Data exports → Patients**, set both dates to **Any time**, then **Export data**. Download the **Data file** CSV to preserve patient numbers and upload it unchanged.

Balm reads the patient number, first and last name, birth date, email and mobile. The patient file does not contain appointments, charts or billing records. [Cliniko’s patient export instructions](https://help.cliniko.com/en/articles/1780957-exporting-patients).

## Check before you switch

- Check every patient’s name and birth date. Select the date order used in the file; dates that could be read two ways are flagged.
- Compare the patient count with the total shown in the old system. For visits, compare each month’s count. The initial file count is calculated from the upload; enter the old system’s total for an independent check.
- Read every warning and every column left out. Errors stop the import. A difference or omission needs your written reason before you can proceed.
- After importing, open **View reconciliation** in the history. It keeps the totals and your acceptance reason. Open a patient’s file to see the imported records.
- Keep your original charts, invoices, payments, claims, authorizations and intake forms. These patient reports do not establish a complete clinic migration. Opening balances previously brought into Balm are separate from collectible invoices and do not appear on payment statements.

The documented report fields were checked against these vendor guides on 18 October 2026. Automated checks use fictional records in those documented shapes; no private clinic export was used.


## Reconciliation inventories

For a reviewed conversion bundle, **Reconcile records still to carry** accepts separate invoice, authorization and open-claim CSV inventories. Each uses these columns:

```csv
Source ID,Patient ID,Reference
synthetic-balm-601,synthetic-balm-600,Original invoice number 41
```

Use the patient identifier from the uploaded patient list. Source identifiers must be unique within each inventory category, and every row needs its original reference. An unknown patient or duplicate identifier blocks apply.

These inventories preserve the source records for reconciliation only. Their source counts are compared with zero native carry: they do not create a collectible invoice, claim balance or usable authorization. The preview names every inventory row still to carry. Enter independent source counts, including historical documents and insurance policies, then **Check totals again**; changed controls require fresh mapping and cutover approvals. A written reason is required before accepting any difference or omission. The saved reconciliation retains those controls, differences and references with the reviewed source files. Keep the originals and complete their carry separately before relying on a complete cutover. Pre-cutover receivables and their run-out use the existing insurance run-out door.

## Reviewed open-claim carry

An open-claim inventory remains a list of records still to carry. To carry actual receivables together with the patient list, upload a reviewed conversion CSV in the **Claims** field with these headers instead:

```csv
Source ID,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status
synthetic-balm-611,synthetic-balm-610,synthetic-balm-620,synthetic-balm-612,synthetic-balm-613,2026-01-15,100.00,80.00,open
```

This is Balm's reviewed conversion format, not a native vendor export. Use the uploaded patient identifier and the identifier of a payer already configured in Balm. Preserve the original source claim number and both claim controls; leave the payer control blank only when the payer has not assigned one. Service dates use the selected date order. Billed and balance amounts are USD decimals; a carried open balance must be positive and cannot exceed the original billed amount. Supported states are `open`, `denied` and `rejected`.

Upload the independent source aging balances in the same section:

```csv
Patient ID,Balance
synthetic-balm-610,80.00
```

Every patient with carried claims needs an aging balance. The sum of their claim balances must match that balance and the reviewed source control exactly; a written acceptance reason cannot waive a difference. Other opening balances retain their existing review. The aging record is a source control, not another collectible balance or a new invoice.

The preview shows each claim and its remaining amount, the carried count and the source aging comparison. An unknown patient or payer, reused source claim, ambiguous claim control, changed payer mapping or closed run-out stops cutover. Only the owner approves the exact mapping and cutover. Patients, original source files, source aging, receivables and the saved reconciliation are committed together; a failed transaction adds nothing.

These claims enter the existing receivables run-out with their original controls, dates, billed amounts and balances. Repeating the unchanged bundle or using the run-out import with the same originals adds no second claim and never resets a later payment. Source aging remains an immutable cutover snapshot; the run-out shows the current remaining amount. Carried receivables stay under existing retention custody and prevent undo of the bundle, even before a payment. Use the retained original records and reviewed retention process. This carry does not send a claim, create an invoice or establish a complete native cutover; native invoice carry remains incomplete. Usable authorizations can use the separate reviewed carry below.

## Reviewed authorization carry

The **Authorizations inventory or carry** field also accepts usable authorizations in Balm's reviewed conversion format. This is not a native vendor layout. Use one row per source authorization and repeat the exact same policy facts for authorizations sharing a source policy identifier:

```csv
Source ID,Patient ID,Policy ID,Payer ID,Member ID,Policy Starts On,Policy Ends On,Number,Starts On,Ends On,Cutover On,Allowance Kind,Allowance,Used,Units Per Visit,CPT Scope,Practitioner ID,Booking Action,Patient Sex,Address,City,State,Postal Code
synthetic-balm-632,synthetic-balm-630,synthetic-balm-634,synthetic-balm-620,synthetic-balm-636,2020-01-01,2099-12-31,synthetic-balm-638,2026-01-01,2099-12-31,2026-01-15,visits,12,8,,,,block,F,1 Example St,Austin,TX,78701
```

Use the uploaded patient identifier and a configured Balm payer identifier. Source policy identifiers must identify the same patient and coverage every time. Policies retain their own coverage dates; authorization dates must be inside that coverage. The patient birth date, sex and address must support a valid insurance policy. Self coverage is the default relationship; dependent coverage additionally supplies `Relationship` (`01` or `19`), `Subscriber First`, `Subscriber Last`, `Subscriber DOB` and `Subscriber Sex`. `Group Number` and `Plan Name` are optional. `Priority` uses the existing policy priority of 1, 2 or 3, defaulting to primary (1). An ongoing policy can leave `Policy Ends On` blank; authorization dates still need a definite end.

`Allowance Kind` is `visits` or `units`. `Allowance` is the original granted total and `Used` is the amount already consumed before `Cutover On`, not the amount remaining. Units also require `Units Per Visit`, the reservation for an unsigned visit. `CPT Scope` contains space-separated procedure codes; blank retains the existing unrestricted scope. `Practitioner ID` is an active Balm practitioner identifier, or blank for unrestricted practitioner coverage. `Booking Action` must explicitly be `warn` or `block`.

The cutover date is in the clinic time zone, within the authorization dates, and cannot be in the future. Original authorization dates stay intact. Imported historical visits before that date do not consume the allowance again. Visits on or after it use Balm's existing attendance, signed-charge and booking-reservation accounting. The prior source usage baseline and its measurement dimension cannot be edited. Native saves refuse a change between visits and CPT units; a source visit is never reinterpreted as a unit. Reports before the baseline do not reconstruct historical authorization usage. Imported authorizations join the patient's legacy unfiled history; an episode is never guessed.

The owner reviews the policy and authorization counts and exact source facts before approving cutover. Patients, policies, authorizations, originals and saved reconciliation commit together. Invalid coverage, conflicting source policy facts, unknown payers or inactive practitioners stop apply. Changed payer or practitioner mappings require a new preview. Repeating the same bundle preserves subsequent usage. Native policy retention custody prevents undo of the bundle; retain originals and use the existing reviewed retention process. A three-column inventory still carries no usable authorization. Native packages and native invoice carry remain incomplete.


## Reviewed historical invoice carry

The **Invoices inventory or carry** upload accepts complete historical invoice facts in a reviewed conversion CSV:

```csv
Source ID,Patient ID,Reference,Issued On,Billed,Balance
synthetic-balm-801,synthetic-balm-800,Original invoice 801,2000-01-15,100.00,80.00
```

Each row keeps the original reference, issue date, billed amount and remaining balance at cutover, including paid invoices with zero remaining balance. Amounts are USD decimals. An invoice cannot have a negative amount or a remaining balance above its billed amount. Account credits must be reconciled against the source before carry; no adjustment is invented.

Upload independent net source aging in the **Source aging balances** field. For every patient with detailed invoices, the sum of their remaining invoice balances must match the aging and the owner's source control exactly. A mismatch, missing aging or unknown patient blocks cutover and cannot be waived by an acceptance reason. Three-column invoice inventories still name records left to carry and do not become invoice records.

The owner sees the original invoice facts and source count beside the Balm count before approving the exact mapping and cutover. The same transaction saves patients, historical invoices, opening balances, original files and the reconciliation. The patient's **Moved-in records** section shows historical invoices to the owner and reception, separately from newly issued invoices. Historical invoices do not issue another bill, initiate collection or add a second debt on top of opening balances. Open insurer receivables still use the reviewed claim carry and the existing run-out door.

Historical invoice facts are immutable, repeat imports add nothing, and new work or changed imported records prevents undo. They join archive custody and reviewed retention destruction; recent import extends retention rather than backdating it to the original invoice. Approved destruction removes source identifiers and references and preserves anonymous dated amount facts. This conversion format does not establish support for complete native vendor packages or their native invoice layouts.
