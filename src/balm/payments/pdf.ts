// Patient documents as PDF, adapted from Pantry's invoice PDF (src/pantry/invoice-pdf.ts,
// just-every/run-pantry @ 6e1e28e): set in the standard Helvetica fonts so the
// file needs no embedded font; text outside Windows-1252 is replaced; long
// documents continue onto further pages, repeating a table's header.
export type Column = { label: string; width: number; right?: boolean }
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'facts'; rows: [string, string][] }
  | { kind: 'table'; columns: Column[]; rows: string[][]; totals?: [string, string][] }
  | { kind: 'notes'; lines: string[] }
export type PdfDocument = { header: string; title: string; blocks: Block[] }

const CP1252: Record<string, number> = { '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, '−': 0x2d }

function encode(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    out.push(CP1252[ch] ?? (code >= 0x20 && code <= 0xff && (code < 0x7f || code >= 0xa0) ? code : 0x3f))
  }
  return out
}

/** A PDF string literal: (…) with its delimiters escaped. */
function literal(text: string) {
  return '(' + encode(text).map(b => b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b < 0x80 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0')).join('') + ')'
}

// Helvetica advance widths (per 1000 em) for figures and common punctuation; other characters are approximated.
const WIDTH: Record<string, number> = { '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, '$': 556, ',': 278, '.': 278, '-': 333, ' ': 278, '(': 333, ')': 333, ':': 278 }
const width = (text: string, size: number) => [...text].reduce((w, ch) => w + (WIDTH[ch] ?? (ch === ch.toUpperCase() && /[A-Z]/.test(ch) ? 667 : 520)), 0) * size / 1000

/** Wrap to a width in points on word boundaries. */
function wrap(text: string, room: number, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && width(line + ' ' + w, size) > room) { lines.push(line); line = '' }
    line = line ? line + ' ' + w : w
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export function pdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
  const W = 612, H = 792, M = 54, pages: string[][] = [[]]
  let y = H - M
  const page = () => pages[pages.length - 1]
  const text = (x: number, size: number, value: string, bold = false) => page().push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${literal(value)} Tj ET`)
  const right = (xr: number, size: number, value: string, bold = false) => text(xr - width(value, size), size, value, bold)
  const rule = () => page().push(`0.75 w ${M} ${y.toFixed(2)} m ${W - M} ${y.toFixed(2)} l S`)
  const room = (needed: number) => { if (y - needed < M) { pages.push([]); y = H - M; return true } return false }

  text(M, 11, doc.header, true); y -= 30
  text(M, 22, doc.title, true); y -= 28
  for (const block of doc.blocks) {
    if (block.kind === 'heading') { room(40); y -= 6; text(M, 12, block.text, true); y -= 18 }
    if (block.kind === 'facts') {
      for (const [k, v] of block.rows) {
        const rows = wrap(v, W - 2 * M - 150, 10)
        room(rows.length * 14)
        text(M, 10, k, true); rows.forEach(r => { text(M + 150, 10, r); y -= 14 })
      }
      y -= 10
    }
    if (block.kind === 'table') {
      const total = block.columns.reduce((t, c) => t + c.width, 0), xs: number[] = []
      block.columns.reduce((x, c) => { xs.push(x); return x + (W - 2 * M) * c.width / total }, M)
      const cellWidth = (i: number) => (W - 2 * M) * block.columns[i].width / total - 8
      const head = () => { block.columns.forEach((c, i) => c.right ? right(xs[i] + cellWidth(i), 9, c.label, true) : text(xs[i], 9, c.label, true)); y -= 6; rule(); y -= 15 }
      room(40); head()
      for (const cells of block.rows) {
        const wrapped = cells.map((cell, i) => block.columns[i].right ? [cell] : wrap(cell, cellWidth(i), 10)), height = Math.max(...wrapped.map(w => w.length)) * 13 + 4
        if (room(height)) head()
        const top = y
        wrapped.forEach((lines, i) => { y = top; lines.forEach(l => { block.columns[i].right ? right(xs[i] + cellWidth(i), 10, l) : text(xs[i], 10, l); y -= 13 }) })
        y = top - height
      }
      if (block.totals?.length) {
        room(20 + block.totals.length * 16); y += 6; rule(); y -= 17
        for (const [k, v] of block.totals) { const last = k === block.totals[block.totals.length - 1][0]; text(W - M - 240, 10, k, last); right(W - M - 8, 10, v, last); y -= 16 }
      }
      y -= 10
    }
    if (block.kind === 'notes') for (const n of block.lines) { for (const r of wrap(n, W - 2 * M, 9)) { room(13); text(M, 9, r); y -= 13 } y -= 4 }
  }

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then page + content pairs.
  const objects: string[] = []
  const font = (name: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, font('Helvetica'), font('Helvetica-Bold'))
  for (const [i, ops] of pages.entries()) {
    const stream = ops.join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  for (const [i, o] of objects.entries()) { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Every character above is one byte (literals escape non-ASCII as octal).
  return Uint8Array.from(body, ch => ch.charCodeAt(0))
}
