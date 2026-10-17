import type { Signature } from './input'

// Standalone PDF writer: text is escaped to ASCII, so byte offsets are exact.
const literal = (value: string) => '(' + value.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, c => '\\' + c) + ')'
export type ConsentDocument = {
  clinic: string; patient: string; formTitle: string; formVersion: string; formId: string;
  questions: { id: string; label: string }[]; answers: Record<string, string | boolean>;
  policyVersion: string; policyText: string; signer: string; relationship: string;
  signature: Signature; signedAt: string; ip: string; responseId: string
}

/** Includes every answered question, exact policy text and the actual signature. */
export function consentPdf(d: ConsentDocument): Uint8Array<ArrayBuffer> {
  const pages: string[][] = [[]]; let y = 738
  const page = () => pages[pages.length - 1]
  const room = (height: number) => { if (y - height < 54) { pages.push([]); y = 738 } }
  const line = (value: string, bold = false, size = 10) => {
    // Character wrapping also bounds long unbroken answers and URLs.
    const max = size > 12 ? 52 : 87
    for (const para of value.split(/\r?\n/)) {
      let remaining = para
      do {
        let end = Math.min(max, remaining.length)
        if (end < remaining.length && remaining.lastIndexOf(' ', end) > max / 2) end = remaining.lastIndexOf(' ', end)
        room(size + 5); page().push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 54 ${y} Td ${literal(remaining.slice(0, end))} Tj ET`)
        y -= size + 5; remaining = remaining.slice(end).trimStart()
      } while (remaining)
    }
  }
  line(d.clinic, true, 15); line('Signed intake and treatment acknowledgment', true, 16)
  line(`Patient: ${d.patient}`); line(`Form: ${d.formTitle} (version ${d.formVersion}; ${d.formId})`)
  line(`Response: ${d.responseId}`); line(`Policy version: ${d.policyVersion}`); y -= 10
  line('Acknowledgment', true, 12); line(d.policyText); y -= 10
  line('Intake answers', true, 12)
  for (const q of d.questions) {
    line(q.label, true)
    const answer = d.answers[q.id]
    line(answer === true ? 'Yes' : answer === false ? 'No' : answer ?? '(No answer)'); y -= 6
  }
  room(225); y -= 10
  line(`Signed by: ${d.signer} (${d.relationship})`, true)
  line(`Signed at (UTC): ${d.signedAt}`); line(`Recorded IP: ${d.ip || 'Unavailable'}`)
  line('Signature:', true)
  if (d.signature.kind === 'typed') line(d.signature.name, true, 20)
  else {
    page().push('q 0.08 0.12 0.18 RG 1.5 w 1 J 1 j')
    for (const stroke of d.signature.strokes) {
      page().push(stroke.map(([x, v], i) => `${(54 + x * 504).toFixed(2)} ${(y - v * 135).toFixed(2)} ${i ? 'l' : 'm'}`).join('\n') + '\nS')
    }
    page().push('Q'); y -= 145
  }
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  for (const [i, ops] of pages.entries()) {
    const stream = ops.join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let body = '%PDF-1.4\n'; const offsets: number[] = []
  objects.forEach((object, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}
