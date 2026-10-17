Bring your patient list across from Cliniko. You upload Cliniko's patient export, check every patient in a preview table, then import them. You can read each import's journal and download the exact file it read, and undo an import later. Only patient details move: appointments, notes and invoices stay in Cliniko.

## Export your patients from Cliniko

1. In Cliniko, go to **Settings → Data & docs → Data exports**. Only Cliniko administrators can export.
2. Choose **Patients**, set both dates to **Any time**, and select **Export data**. It can take a few minutes.
3. Download the file when it is ready: a CSV file named like `Patients-Cliniko-20261017.csv`.

Keep the file as it is. Balm reads these columns by their headers and leaves every other column out:

| Balm reads | Header in the file |
|---|---|
| Cliniko patient ID (required) | `ID` or `Patient ID` |
| First name (required) | `First Name` |
| Last name (required) | `Last Name` |
| Date of birth | `Date of Birth` |
| Email | `Email` |
| Mobile | `Mobile` (or `Mobile Phone`, `Phone`) |

Up to 1,000 patients and 1 MB per file. For a bigger list, export a smaller date range in Cliniko and import each file in turn.

## Dates of birth

Balm reads dates as US **MM/DD/YYYY** unless you choose another format next to the upload: **DD/MM/YYYY** or **YYYY-MM-DD**. Dates written `YYYY-MM-DD` are always read as such. The preview says which format it used.

- A date that could be read either way, such as `04/12/1988` (April 12 or December 4), is read in the chosen format and flagged in the preview with both readings, so you can check it against Cliniko. Balm never swaps day and month on its own.
- A date that is impossible in the chosen format, such as `25/12/1990` read as MM/DD/YYYY, stops the preview with the line number, and says to choose the other format if the file writes the day first.

To read the same file with another format, open **Change the date format** in the preview and select **Preview again with this date format**.

## Import

1. Open **Move in** (owner only), choose the file under **Cliniko patient export**, and select **Preview patients**. Nothing is imported yet.
2. Check the table: each patient's name, date of birth, email, mobile and Cliniko ID. A patient already in Balm (same Cliniko ID, or the same name, date of birth and email) or erased from Balm before is marked; remove those rows from the file and preview it again.
3. Tick **I checked these patients** and select **Import**. If the file or your clinic changed since the preview, Balm asks you to preview again.
4. Under **Imports**, each import shows its progress, for example "Imported: 120 of 120 patients". **View journal** offers **Download the original file**, exactly as you uploaded it. Each imported patient's access audit records the import.

## Undo

**Undo this import** (confirm with the tick box) removes the imported patients who are unchanged and unused. Anyone booked, edited, or given an intake, a note, an invoice or a draft in Balm since is kept. The journal then lists each patient and what happened to them.

## Try it

[cliniko-export-us.csv](https://github.com/just-every/run-balm/blob/main/tests/fixtures/cliniko-export-us.csv) is a made-up export with extra columns and US dates, including one date that is flagged as readable either way. Balm has not yet been tried with a real Cliniko export, so check the preview carefully the first time.
