import { form, h, hidden, panel, select, stamp } from './shared'

/** Uses the patient file's existing forms and disclosure layout. */
export function lettersPanel(s: any, f: any) {
  if (!f.letters) return ''
  const path='/app/clients/'+f.client.id
  const notes=(f.notes??[]).filter((n:any)=>n.status==='signed' && n.authorId===s.actor.staffId)
  const list=f.letters.map((l:any)=>`<article class="entry"><h3>Progress letter</h3><p>${h(JSON.parse(l.snapshot).author)} · ${h(JSON.parse(l.snapshot).episode)}</p><p>${l.delivered_at?'Delivered to patient portal '+stamp(s,l.delivered_at):'Draft · not delivered'}</p><p><a href="/api/balm/letters/${h(l.id)}.pdf">Review exact PDF</a></p>${l.delivered_at?`<a href="/api/balm/chart-documents/${h(l.document_id)}">Download delivered original</a>`:`<details><summary>Review and edit letter</summary>${form('letter.edit',path,hidden('id',l.id)+hidden('sha256',l.sha256)+`<label>Letter text<textarea name="body" rows="12" maxlength="20000" required>${h(l.body)}</textarea></label>`,'Save letter draft')}</details>${form('letter.deliver',path,hidden('id',l.id)+hidden('sha256',l.sha256)+'<label class="check"><input type="checkbox" name="attest" value="on" required><span>I reviewed this exact PDF and approve delivering it to this patient’s portal. Its original will be fixed.</span></label>','Deliver to patient portal')}`}</article>`).join('')
  const prepare=notes.length?`<details><summary>Prepare progress letter</summary>${form('letter.prepare',path,select('noteId','Signed source note',notes.map((n:any)=>[n.id,n.createdAt+' · '+(n.template||'Treatment note')])),'Prepare chart-filled draft')}</details>`:'<p>Sign your treatment note before preparing a progress letter.</p>'
  return panel('Clinical letters',list+prepare,'full','clinical-letters')
}
