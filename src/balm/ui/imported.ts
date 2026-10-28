import { empty, entry, h, money, panel } from './shared'

export function importedPanel(f: any) {
  const records = f.imported
  if (!records || !(records.notes?.length || records.balances?.length || records.insurance?.length || records.invoices?.length)) return ''
  const notes = records.notes?.length ? '<h3>Read-only historical documents</h3>' + records.notes.map((n: any) => entry(n.title, `<p class="help">${h(n.provider)} · ${h(n.source_date ?? n.date ?? '')}</p><div style="white-space:pre-wrap">${h(n.body)}</div>`, `historical-${n.id}`)).join('') : ''
  const balances = records.balances?.length ? '<h3>Opening balances</h3>' + records.balances.map((b: any) => `<p>${h(b.provider)}: <strong>${h(money(b.cents ?? b.amount_cents))}</strong>. This is the balance carried from the previous system.</p>`).join('') : ''
  const insurance = records.insurance?.length ? '<h3>Imported insurance</h3>' + records.insurance.map((p: any) => `<p>${h(p.payer)} · Member ${h(p.member_id)}${p.group_number ? ` · Group ${h(p.group_number)}` : ''}</p>`).join('') : ''
  const invoices = records.invoices?.length ? '<h3>Historical invoices</h3><p>Original invoice amounts at cutover. Their remaining balances are included in opening balances; these records are not new bills or a second charge.</p>' + records.invoices.map((i: any) => entry(i.reference, `<p>${h(i.provider)} · Issued ${h(i.issued_on)}</p><p>Billed ${h(money(i.billed_cents))} · Remaining at cutover ${h(money(i.balance_cents))}</p>`)).join('') : ''
  return panel('Moved-in records', notes + balances + insurance + invoices || empty('No moved-in records.'), 'full')
}
