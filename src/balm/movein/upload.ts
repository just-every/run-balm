import { read, utils, SSF } from 'xlsx'
import { ImportError } from './errors'

/** Read the downloaded spreadsheet directly. Preserve displayed identifiers; dates use calendar days. */
export async function uploadText(file: File) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) return file.text()
  try {
    const book = read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true, dateNF: 'yyyy-mm-dd' })
    if (book.SheetNames.length !== 1) throw new Error('Choose the patient-list export with one worksheet.')
    const sheet = book.Sheets[book.SheetNames[0]]
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith('!') || cell.t !== 'n' || !cell.z || !SSF.is_date(cell.z)) continue
      const date = SSF.parse_date_code(cell.v)
      if (!date) throw new Error('A date in this spreadsheet is invalid.')
      cell.t = 's'; cell.v = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`; delete cell.w
    }
    return utils.sheet_to_csv(book.Sheets[book.SheetNames[0]], { blankrows: false, dateNF: 'yyyy-mm-dd' })
  } catch (error) {
    throw new ImportError('invalid_spreadsheet', 422, `The spreadsheet could not be read. ${error instanceof Error ? error.message : 'Download it again from your old system.'}`)
  }
}
