import { form, h, hidden, stamp } from './shared'

/** Fits the existing draft's clinical review controls; no automatic edits or signing. */
export function defensibility(s: any, note: any, path: string) {
  const revision = note.revisions[0].number, check = note.defensibility
  const checked = !check ? '' : `<div class="notice" data-defensibility-result><strong>Documentation questions · revision ${h(check.revision)}</strong>
    <p class="help">${stamp(s, check.checkedAt)} · ${h(check.model)}. ${check.revision !== revision ? 'The draft has changed. Run a new check before relying on these questions.' : 'Based on the plan and payer rules at that time; recheck after either changes.'} This is AI feedback, not payer validation or certification. You decide every edit and whether to sign.</p>
    ${check.findings.length ? `<ol>${check.findings.map((f: any) => `<li><strong>${h(f.kind.replaceAll('_', ' '))}</strong>: ${h(f.question)}<blockquote>${h(f.evidence)}</blockquote><p class="help">${f.ruleIds.map((id: string) => { const r = check.rules.find((r: any) => r.id === id); return `<a href="${h(r.source)}">${h(r.title)}</a>: ${h(r.rule)}` }).join('<br>')}</p></li>`).join('')}</ol>` : '<p>No documentation questions returned by the model. Review the record yourself before signing.</p>'}</div>`
  if (!(note.mine || note.canCosign) || note.status === 'signed') return checked
  return `<details${check ? ' open' : ''} data-defensibility><summary>Check documentation defensibility</summary>
    <p class="help">Send this draft, its plan of care, minutes and applicable payer documentation rules to the clinic’s configured AI model for questions with sources. Save your edits first. The check never changes or signs your note.</p>${checked}
    ${s.scribe?.ready ? form('note.check', path, hidden('id', note.id) + hidden('revision', revision), check ? 'Recheck documentation' : 'Check documentation') : '<p class="help">Configure and test the clinic’s AI model in Clinic → Scribe to use this check.</p>'}</details>`
}
