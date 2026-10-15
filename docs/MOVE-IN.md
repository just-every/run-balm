# Move in from Cliniko

Balm's first move-in kit brings a patient list across from a Cliniko patient export. It runs on Base's import-kit: preview, apply the exact preview, a journal with the original file, and undo.

## The file

Cliniko's **Settings → Data exports → Patients** export has many columns. Balm reads these six, with exactly these headers, in this order:

```
ID,First Name,Last Name,Date of Birth,Email,Mobile
```

`First Name`, `Last Name` and `Date of Birth` are Cliniko's documented patient field names; `ID` is the patient ID the export carries. Keep those six columns from your export (in a spreadsheet, delete the others) and save as CSV. `ID`, `First Name` and `Last Name` are required; dates may be `YYYY-MM-DD` or `DD/MM/YYYY`. Up to 1,000 patients and 1,000,000 bytes per file.

[tests/fixtures/cliniko-patients.csv](../tests/fixtures/cliniko-patients.csv) is a synthetic example in this shape. No real Cliniko export was available, so compatibility with a real export is not yet proven: check the preview carefully.

## Steps

1. **Move in** (owner only): paste the CSV and **Preview patients**. Nothing is written. The preview lists every client row, any diagnostics, and conflicts: a patient already in Balm (same ID, or same name and date of birth) needs review, and an erased client cannot be imported again.
2. **Apply this exact preview**. The fingerprint binds the preview to the exact file and the clinic's current state; a changed file must be previewed again.
3. **View journal** shows the job, its batches, the original CSV and the undo report. Imported clients are marked *Imported* and each one's access audit records `client.imported`.
4. **Undo completed import** removes imported clients that are unchanged and unused. A client who has since been edited, booked, given an intake, a note, an invoice or a draft is kept, and the undo report says why.

Only client details move. Appointments, notes and invoices stay in Cliniko.
