export type CsvRow = { cells: string[]; row: number }

/** Comma-delimited UTF-8 text; preserves the physical start line of multiline records. */
export function readCsv(source: string): CsvRow[] {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 1_000_000) throw new Error('CSV must be text of at most 1,000,000 bytes.')
  if (source.includes('\0')) throw new Error('Binary files are unsupported; supply UTF-8 CSV text.')
  const text = source.replace(/^\uFEFF/, ''), rows: CsvRow[] = []
  let cells: string[] = [], cell = '', state: 'plain' | 'quoted' | 'closed' = 'plain', line = 1, start = 1
  const push = () => { cells.push(cell); rows.push({ cells, row: start }); cells = []; cell = ''; state = 'plain' }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === 'quoted') {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else state = 'closed' }
      else { cell += ch; if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++ }
      continue
    }
    if (ch === '"') { if (state !== 'plain' || cell) throw new Error(`Unexpected quote at line ${line}.`); state = 'quoted'; continue }
    if (ch === ',') { cells.push(cell); cell = ''; state = 'plain'; continue }
    if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); line++; start = line; continue }
    if (state === 'closed') throw new Error(`Unexpected text after closing quote at line ${line}.`)
    cell += ch
  }
  if (state === 'quoted') throw new Error(`Unclosed CSV quote beginning at line ${start}.`)
  if (cell || cells.length || state === 'closed') push()
  if (rows.length > 10_001) throw new Error('A file may contain at most 10,000 data rows.')
  return rows
}
