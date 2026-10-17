Checked against public provider documentation on 17 October 2026. This adapter is a reviewed CSV normalization step, not a complete migration from any of these systems. It accepts a subset of Cliniko patient exports, supported patient report fields, and explicitly converted Balm CSVs. Provider selection records provenance; it does not establish that every uploaded file is a native provider export.

## What the providers actually export

| Provider | Documented export | Current adapter boundary |
| --- | --- | --- |
| Cliniko | Patient CSV with patient IDs; current calendar events and attendees are separate exports. Calendar events have no patient information. Attachments export as patient-organized ZIP archives. | Reads patient ID, first/last name, birth date, email and phone by header. Use the **Data file** option to preserve raw IDs. Related data needs conversion; the adapter does not join calendar events to attendees or unpack attachments. |
| WebPT | WebPT publicly documents practice data export to CSV. | No public, authoritative column dictionary for the Data Export package, scheduler or A/R report was located during this work. Only the explicit Balm conversion layout below is implemented. Fixtures do not establish native WebPT compatibility. |
| SimplePractice | The ordinary complete data export is a ZIP with client folders and clinical/billing documents; contacts can be vCard. Appointments require a separate report. Client details and demographics reports can be CSV/Excel. A separate transfer workflow also provides a client-list CSV. | Supports the documented Client, Email, Phone number, Primary insurance and Insurance ID fields of the Client details report. Birth date is accepted if included from another reviewed source. Other report fields remain unmapped. No ZIP, vCard, clinical document extraction, or automatic appointment report conversion. |
| Jane | Patient and appointment reports can be exported. Batch charts are PDFs with a mapping spreadsheet; intake can be exported per patient. Profile notes and insurance policies have their own reports. | Accepts the named patient demographic subset when headers match. Jane's public guides do not establish an exhaustive export header contract. Related data uses the explicit conversion CSV below. Chart PDFs, mapping spreadsheets and intake PDFs are not imported by this adapter. |

Primary sources: Cliniko [patient export](https://help.cliniko.com/en/articles/1780957-exporting-patients), [patient ID column](https://help.cliniko.com/en/articles/12057800-archive-your-patients-in-bulk), [calendar events and attendees](https://help.cliniko.com/en/articles/5167881-export-appointment-calendar-and-attendees-data), [data versus spreadsheet formats and attachments](https://help.cliniko.com/en/articles/1023831-export-your-data); WebPT [practice management export FAQ](https://www.webpt.com/practice-management); SimplePractice [data exports](https://support.simplepractice.com/hc/en-us/articles/207625506-Exporting-client-information-through-data-exports), [report fields](https://support.simplepractice.com/hc/en-us/articles/13218379819661-Understanding-your-clients-and-appointments-reports), [transfer client-list CSV](https://support.simplepractice.com/hc/en-us/articles/40942106623373-Viewing-and-sharing-exported-data-for-transfer); Jane [export workflow](https://jane.app/guide/importing-from-jane), [patient reports](https://jane.app/guide/patients-reports), [chart and intake exports](https://jane.app/guide/exporting-chart-notes-print-or-pdf).

Jane's [insurance policies report](https://jane.app/guide/insurance-policy-report) distinguishes patient, insurer, claim and policy information. A claim number or policy number must not silently become a US member ID. Its [A/R report](https://jane.app/guide/accounts-receivable-report) includes patients and insurers and excludes account credit from the outstanding invoice total. Review patient/insurer responsibility and credit separately before preparing a net patient opening balance. This adapter does not reconstruct invoices, claims, authorizations, remaining visits, payer receivables or an A/R run-out ledger.

SimplePractice's separated-data option matters: when excluded, restricted clients retain contact information while their other records are omitted. This adapter always raises `separated_data_unverified`; CSV content cannot prove the export setting or identify every affected client. Review the original settings and record the affected clients separately. These CSVs alone cannot prove MOVE-004 completeness. See [SimplePractice's restricted-client export guidance](https://support.simplepractice.com/hc/en-us/articles/207625506-Exporting-client-information-through-data-exports).

## Explicit Balm conversion templates

The following are **Balm layouts for a reviewed conversion**, not undocumented native provider schemas. Preserve the original exports and retain a conversion record showing how each field was obtained. Never rename a PDF to CSV or infer patient links from filenames alone.

| File kind | CSV header | Meaning |
| --- | --- | --- |
| patients | `Patient ID,First Name,Last Name,Date of Birth,Email,Phone Number` | Stable source ID and names required; remaining fields may be empty. |
| appointments | `Source ID,Patient ID,Start At,End At,Status` | Stable appointment ID; patient reference; explicit offset timestamps; reviewed status. |
| notes | `Source ID,Patient ID,Title,Body,Date` | Historical text only, imported read-only by the domain layer. Not a native clinical note export, signed Balm note or PDF import. |
| balances | `Patient ID,Balance` | One reconciled net USD opening balance per patient. Not an invoice or payment. |
| insurance | `Source ID,Patient ID,Payer,Member ID,Group Number` | Policy provenance ID, patient reference and coverage identifiers. Group number may be empty. Does not establish eligibility or billing readiness. |

Copyable examples, all synthetic:

```csv
Patient ID,First Name,Last Name,Date of Birth,Email,Phone Number
source-1001,Maya,Santos,1988-04-12,maya@patients.example,+1 202-555-0101
```

```csv
Source ID,Patient ID,Start At,End At,Status
visit-201,source-1001,2026-11-02T09:00:00-05:00,2026-11-02T09:45:00-05:00,booked
```

```csv
Source ID,Patient ID,Title,Body,Date
note-301,source-1001,Historical progress note,Synthetic historical record only.,2026-10-05
```

```csv
Patient ID,Balance
source-1001,125.50
```

```csv
Source ID,Patient ID,Payer,Member ID,Group Number
policy-401,source-1001,Example Health Plan,EX-SYNTH-1001,REHAB-01
```

Headers are case-insensitive, trim surrounding whitespace and treat underscores as spaces. Patient ID also accepts Client ID, Source ID or ID. First/last names accept First/Last/Surname; birth date accepts DOB/Birth Date/Birthday; email accepts Email Address; phone accepts Phone/Mobile/Mobile Phone/Mobile Number. Appointments accept Starts At/Ends At and Start Time/End Time, but their values still require complete offset timestamps. Notes accept Note Text and Note Date. Balance accepts Amount; payer accepts Insurer/Primary Insurance, member ID accepts Insurance ID and group number accepts Group ID. Multiple aliases for the same field in one file are rejected rather than picking one.

For SimplePractice or Jane patient reports with Client/Patient/Patient Name/Client Name/Name instead of split names, the adapter splits a comma name as `Last, First`, otherwise at the first space. It flags every split for review. This rule does not establish the legal parts of a compound name. Supply explicit first/last names when needed.

If such a report has no patient ID, normalized full name plus email is used for a derived preview ID, or normalized full name plus birth date when email is absent. Name alone is refused. Duplicate derived IDs are errors. Review distinct people sharing an email and changes to email/birth date across exports; derived IDs are not provider IDs. Use the exact ID shown in the preview in converted related files. The adapter never matches related rows by name. Client details' Primary insurance plus Insurance ID produces one policy; a payer with no member ID is an error.

## Validation and reconciliation

Every row carries its original filename and physical starting line, including multiline quoted text. Unknown columns are listed under `unmappedColumns`; the original CSV remains in `files`. Invalid/held rows appear under `unmappedRows`, with named error diagnostics. Duplicate headers, duplicate source IDs within each record kind, duplicate opening balances, broken CSV quoting and mismatched cell counts are refused. Any related row whose patient ID is absent from this bundle gets `missing_patient_reference`. Preview errors must block applying the bundle.

Dates accept real ISO `YYYY-MM-DD` dates, or numeric MDY/DMY dates using the selected format (default MDY). Ambiguous day/month combinations are flagged. Invalid dates are never rolled into another month. Source timestamps require `Z` or an explicit UTC offset, with no guessing of server or clinic time zone; convert local scheduler times using the clinic's historical daylight-saving rules first. End must be after start. Overlapping appointments remain present for domain reconciliation. This normalizer does not assign source practitioners or services; the import command must review their destination mapping.

Statuses normalize booked/scheduled to `booked`, attended/arrived/completed to `attended`, canceled/cancelled to `cancelled`, and no-show/no_show/did not arrive to `no_show`. Other statuses require an explicit conversion.

Balances use exact integer cents parsed from decimal text, with no rounding. `125.50`, `$125.50`, `1,250.00`, `-20.00` and `(20.00)` are accepted; fractions finer than cents, malformed grouping, formulas and non-USD symbols are rejected. Negative balances mean credit. Keep payer responsibility separate from patient opening balances and reconcile the total to the original reports.

Limits: 25 uniquely named files; 1,000,000 UTF-8 bytes per CSV; 100 nonempty data rows total and at most 100 normalized records (including policies extracted from patient report rows). Header-only files are errors. First/last names are at most 80 characters each; email 254, phone 40, note title 240, historical note text 100,000. Original exports are not emailed by normalization. No PDF, ZIP, Excel or vCard parser is implemented here.

## Synthetic evidence

Each provider folder in the [move-in test fixtures](https://github.com/just-every/run-balm/tree/main/tests/fixtures/movein) contains patients, appointments, notes, balances and insurance CSVs. Only Cliniko's patient file represents the directly supported native-header subset. All other files are Balm conversions. Each bundle has two patients, three appointments (including an overlapping pair), one multiline historical note, two policies and $165.50 in opening balances. `Legacy flag` demonstrates an unmapped column. All contacts use reserved `.example` addresses and fictional 555 numbers.

`simplepractice-client-details-report.csv` uses the documented report column labels with synthetic rows, demonstrating report identity review and unmapped administrative columns. `invalid-patients.csv` and `invalid-balances-mapped.csv` cover an impossible date, ambiguous dates, a duplicate patient identity, a sub-cent amount and an absent patient reference. These are normalization evidence, not proof of full native exports or the complete MOVE-002 through MOVE-006 acceptance journeys.

## Use a reviewed bundle in Balm

1. Under **Move in**, choose the source, upload each prepared CSV, and map its appointments to one active practitioner and service. Split a conversion into separate bundles when the mapping differs. At most 100 source rows and 100 normalized records fit one bundle.
2. Choose **Preview move-in**. Check names, source IDs, filenames, row numbers, every omitted column, and the named overlapping appointments. No records have been written.
3. Compare patient counts, appointments by month and each patient's opening balance with the original system. The default source column is calculated from the uploaded rows; it is not an independent provider total. Enter the control totals from the original reports and choose **Check totals again**. Appointment months use the clinic time zone, including historical daylight-saving offsets.
4. Resolve errors by correcting the conversion and uploading again. A differing total or omission requires a recorded owner reason. Check the confirmation and choose **Apply move-in**. The reviewed files, mapping and control totals must still match the preview.
5. Read **View reconciliation** in the history. The source controls, destination totals, omissions and owner reason remain with the job. Open a client file to read the historical text and carried balance/policy details. Historical text has no edit action; reception cannot read it.
6. Uploading the unchanged files with the same mapping reuses the job and adds nothing, even if the source controls are entered differently. An undone bundle stays undone on repeat; it is not silently applied again. Changes to already imported source records are refused rather than overwriting current records.
7. **Undo this move-in** removes the entire bundle in one transaction. Any later patient/appointment edit or dependent clinical work blocks the whole undo; it never removes only the unaffected half. The reconciliation remains in the history.

Opening balances are read-only migration records, displayed separately from the native invoice/payment ledger. They are not collectible invoices or insurance claims and do not contribute to Balm's payment statement. Insurance identifiers do not establish coverage or eligibility.
