import { audit, commit, guard, human, id, insist, integer, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { bodyRegions } from './template-elements'
import { template, templates, type Template, type Section } from './templates'

export async function templateCatalog(db: D1Database) {
  const custom = await rows(db, 'SELECT definition FROM bm_clinical_templates t WHERE version=(SELECT MAX(version) FROM bm_clinical_templates x WHERE x.id=t.id) ORDER BY created_at,id')
  return [...templates, ...custom.map(r => JSON.parse(r.definition) as Template)]
}
export async function resolveTemplate(db: D1Database, key: unknown): Promise<Template | undefined> {
  if (!key) return undefined
  const builtIn = template(key)
  if (builtIn) return builtIn
  const row = await one(db, 'SELECT definition FROM bm_clinical_templates WHERE id=? ORDER BY version DESC LIMIT 1', text(key, 'template', 100))
  return row ? JSON.parse(row.definition) as Template : undefined
}
export function noteTemplate(note: Data): Template | undefined {
  if (note.template_snapshot) return JSON.parse(note.template_snapshot)
  const legacy = template(note.template)
  // Previously saved notes retain the original section-only signing rules.
  const original = ['subjective','objective','assessment','goals','plan', ...(legacy?.kind === 'evaluation' ? ['diagnosis'] : []), ...(legacy?.kind === 'progress' ? ['period'] : []), ...(legacy?.kind === 'discharge' ? ['reason'] : [])]
  return legacy ? { ...legacy, version: 1, schemaVersion: 1, sections: legacy.sections.filter(s => original.includes(s.id)).map(s=>s.id==='goals'?{...s,required:true}:s) } : undefined
}
/** New immutable versions can add requirements, never remove the discipline's minimum elements. */
export async function saveClinicalTemplate(db: D1Database, who: Actor, input: Data) {
  human(who); insist(who.role === 'owner', 'only_the_owner_customizes_templates', 403)
  const base = template(input.baseKey); insist(base, 'choose_a_discipline_and_note_type')
  const key = input.id ? text(input.id, 'template', 40) : `ct-${id().replaceAll('-', '').slice(0,16)}.${base.discipline}.${base.kind}`
  insist(!template(key), 'built_in_template_is_fixed')
  const prior = await one(db, 'SELECT version,definition FROM bm_clinical_templates WHERE id=? ORDER BY version DESC LIMIT 1', key)
  insist(!input.id || prior, 'template_not_found', 404)
  if (prior) insist(Number(input.version) === prior.version, 'template_changed_reload', 409)
  if (prior) { const old = JSON.parse(prior.definition) as Template; insist(old.discipline === base.discipline && old.kind === base.kind, 'a_template_version_keeps_its_discipline_and_note_type') }
  const title = text(input.title, 'template_title', 120), bodyRegion = text(input.bodyRegion ?? 'General', 'body_region', 100)
  insist(bodyRegions.includes(bodyRegion), 'choose_a_body_region')
  const diagnosisVariant = String(input.diagnosisVariant ?? '').trim(); insist(diagnosisVariant.length <= 200, 'diagnosis_variant_too_long')
  let raw: unknown = input.customFields
  if (typeof raw === 'string') { try { raw = JSON.parse(raw || '[]') } catch { insist(false, 'invalid_custom_fields') } }
  if (raw === undefined) raw = Array.from({ length: 16 }, (_,n) => ({ id: input[`custom_${n}_id`], label: input[`custom_${n}_label`], help: input[`custom_${n}_help`], required: input[`custom_${n}_required`] === 'on', choices: String(input[`custom_${n}_choices`] ?? '').split(/\r?\n/).map(v=>v.trim()).filter(Boolean) })).filter(f=>f.id || f.label)
  insist(Array.isArray(raw) && raw.length <= 16, 'at_most_sixteen_custom_elements')
  const extra: Section[] = raw.map((f: Data) => {
    const key = text(f.id, 'element_id', 50); insist(/^[a-z][a-z0-9_]*$/.test(key), 'invalid_element_id')
    const choices = f.choices ?? []; insist(Array.isArray(choices) && choices.length <= 30, 'invalid_pick_list')
    return { id: key, label: text(f.label, 'element_label', 120), help: String(f.help ?? '').slice(0, 500), required: f.required === true, ...(choices.length ? { choices: choices.map((c: unknown) => text(c, 'pick_list_choice', 200)) } : {}) }
  })
  const sections = [...base.sections, ...extra]; insist(new Set(sections.map(s => s.id)).size === sections.length, 'element_ids_must_be_unique')
  const version = prior ? integer(prior.version, 'version', 1, 100000) + 1 : 1
  const definition: Template = { ...base, key, title, bodyRegion, diagnosisVariant, version, sections }
  await commit(db, who, [guard(db, '(SELECT COALESCE(MAX(version),0) FROM bm_clinical_templates WHERE id=?)=?', key, version - 1), stmt(db, 'INSERT INTO bm_clinical_templates(id,version,definition,created_by,created_at) VALUES(?,?,?,?,?)', key, version, JSON.stringify(definition), who.email, now()), audit(db, who, 'template.version_created', null, key, `version ${version}`)])
  return { id: key, version }
}
