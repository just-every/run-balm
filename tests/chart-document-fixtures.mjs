// Synthetic originals for chart upload/download and archive journeys.
export const chartPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEAAAAABJRU5ErkJggg=='

/** A valid, one-page synthetic fax scan PDF, with its own cross-reference table. */
export function mriReport(title='MRI report - Marisol Diaz', description='Faxed report filed by the clinic. Right knee: no acute ligament tear.') {
  const stream=`BT /F1 14 Tf 50 740 Td (${title}) Tj 0 -24 Td /F1 11 Tf (${description}) Tj 0 -20 Td (Synthetic report for product testing only.) Tj ET`
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let body='%PDF-1.4\n';const offsets=[0]
  for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${object}\nendobj\n`}
  const xref=Buffer.byteLength(body)
  body+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}
export const mriUpload = (clientId,date) => ({clientId,title:'Faxed right knee MRI report',documentType:'imaging',documentDate:date,searchText:'MRI right knee. No acute ligament tear. Uploaded fax scan; no fax provider verification.',attachmentName:'knee-MRI-report.pdf',attachment:'data:application/pdf;base64,'+mriReport().toString('base64')})
