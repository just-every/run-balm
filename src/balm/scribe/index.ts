// The scribe: the owner enters the install's own model key on the Clinic page
// (sealed at rest, never sent back to a browser); a practitioner gives the visit's
// dictation or bullet points and gets an unsigned draft note to review and sign.
// Without a key the scribe says so and drafts nothing; RER Managed hosting has
// no outbound connection for providers yet, so there it says that in one line.
import type { Bindings } from '../../auth.server'
import { template } from '../charting/templates'
import { audit, commit, human, insist, need, now, one, optional, practitionerId, text, type Actor, type Data } from '../domain/model'
import { createNote, ownAppointment } from '../domain/notes'
import { clientVisible } from '../domain/clients'
import { DEFAULTS, draftNote, ScribeError, type Provider, type ScribeConfig } from './model'
import { seal, unseal } from './seal'

const PURPOSE = 'scribe-model-key'
export const MANAGED_LINE = 'The scribe is not available yet on RER Managed hosting: it has no outbound connection to AI providers. It works on a self-hosted install.'
export const MISSING_LINE = 'Add a key to use the scribe.'

/** RER Managed relays mail through RER and sets an installation beside a remote management origin. */
export function managed(env: Bindings) {
  if (String(env.MAIL_PROVIDER) === 'rer') return true
  if (!env.RER_INSTALLATION_ID || !env.RER_MANAGEMENT_ORIGIN) return false
  try { return !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.RER_MANAGEMENT_ORIGIN).hostname) } catch { return true }
}

type State = { config: ScribeConfig } | { line: string }

async function scribeState(env: Bindings): Promise<State> {
  if (managed(env)) return { line: MANAGED_LINE }
  const row = await one(env.DB, 'SELECT * FROM bm_scribe WHERE id=1')
  if (!row) return { line: MISSING_LINE }
  const key = await unseal(env.SESSION_SECRET, PURPOSE, row.key_sealed as string)
  if (!key) return { line: 'The saved key cannot be opened on this install. Add a key to use the scribe.' }
  return { config: { provider: row.provider as Provider, endpoint: row.endpoint as string, model: row.model as string, key, workspace: row.workspace as string } }
}

/** What pages show: ready or the one line why not; the owner also sees the saved settings without the key. */
export async function scribeStatus(env: Bindings, who: Actor) {
  const state = await scribeState(env)
  const saved = who.role === 'owner' ? await one(env.DB, 'SELECT provider,endpoint,model,workspace,key_hint,updated_by,updated_at FROM bm_scribe WHERE id=1') : null
  return { ready: 'config' in state, line: 'line' in state ? state.line : null, managed: managed(env), saved, defaults: DEFAULTS }
}

async function save(env: Bindings, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  insist(!managed(env), 'scribe_not_available_on_managed_hosting', 409)
  const provider = input.provider
  insist(provider === 'anthropic' || provider === 'openai', 'choose_anthropic_or_an_openai_compatible_provider')
  const endpoint = optional(input.endpoint, 'endpoint', 300) ?? DEFAULTS[provider as Provider].endpoint
  // Loopback http is accepted only on a local install, for a model running on this computer.
  insist(/^https:\/\/[^\s/]+\/\S*$/.test(endpoint) || (env.AUTH_LOCAL === 'true' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\S*$/.test(endpoint)), 'the_endpoint_is_an_https_address')
  const model = optional(input.model, 'model', 120) ?? DEFAULTS[provider as Provider].model
  insist(model, 'enter_the_model_name_your_provider_gave_you')
  // Anthropic keys that are not scoped to one workspace name it in a header.
  const workspace = provider === 'anthropic' ? optional(input.workspace, 'workspace_id', 120) ?? '' : ''
  const current = await one(env.DB, 'SELECT key_sealed,key_hint FROM bm_scribe WHERE id=1')
  const entered = optional(input.key, 'api_key', 400)
  insist(entered || current, 'paste_the_api_key')
  const sealed = entered ? await seal(env.SESSION_SECRET, PURPOSE, entered) : current!.key_sealed
  const hint = entered ? '…' + entered.slice(-4) : current!.key_hint
  await commit(env.DB, who, [
    env.DB.prepare(`INSERT INTO bm_scribe(id,provider,endpoint,model,workspace,key_sealed,key_hint,updated_by,updated_at) VALUES(1,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,model=excluded.model,workspace=excluded.workspace,key_sealed=excluded.key_sealed,key_hint=excluded.key_hint,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(provider, endpoint, model, workspace, sealed, hint, who.email, now()),
    audit(env.DB, who, 'scribe.saved', null, null, `${provider} ${model}${entered ? ', key changed' : ''}`),
  ])
  return { saved: true }
}

async function remove(env: Bindings, who: Actor) {
  need(who, 'owner'); human(who)
  await commit(env.DB, who, [env.DB.prepare('DELETE FROM bm_scribe WHERE id=1'), audit(env.DB, who, 'scribe.removed', null)])
  return { removed: true }
}

// Made-up dictation: the check sends nothing from the clinic's records.
const SAMPLE = 'Pt reports L knee 3/10 after stairs, doing HEP daily. Ther ex 23 min: quad sets, SLR 3x10, step-ups 2x12 6 in. Manual 10 min patellar mobs grade III. Flexion 120 deg, up from 115. Tolerated well. Progress step height next visit.'

async function check(env: Bindings, who: Actor) {
  need(who, 'owner'); human(who)
  const state = await scribeState(env)
  if (!('config' in state)) return { ok: false, message: state.line }
  try {
    const draft = await draftNote(state.config, template('pt.daily')!, 45, SAMPLE)
    const minutes = Object.fromEntries(draft.charges.map(c => [c.code, c.minutes]))
    const ok = minutes['97110'] === 23 && minutes['97140'] === 10 && !!draft.sections.subjective
    return { ok, message: `${ok ? 'It drafted' : 'The model answered, but misread the sample'}: ${draft.charges.map(c => `${c.code} ${c.minutes} min`).join(', ') || 'no codes'}; subjective "${draft.sections.subjective.slice(0, 80)}".` }
  } catch (e) {
    return { ok: false, message: e instanceof ScribeError ? e.message : 'The AI model could not be reached.' }
  }
}

/** Drafts a note from the practitioner's dictation; the draft is unsigned and stays the practitioner's to review. */
async function draft(env: Bindings, who: Actor, input: Data) {
  human(who)
  insist(practitionerId(who), 'only_practitioners_write_notes', 403)
  const client = await clientVisible(env.DB, who, input.clientId)
  const appointment = await ownAppointment(env.DB, who, client.id as string, input.appointmentId)
  insist(appointment, 'choose_the_visit')
  const t = template(input.template || appointment.note_template)
  insist(t, 'choose_a_template')
  const dictation = text(input.dictation, 'dictation', 20_000)
  const state = await scribeState(env)
  insist('config' in state, ('line' in state ? state.line : MISSING_LINE).replace(/\W+/g, '_').replace(/^_|_$/g, '').toLowerCase(), 409)
  const minutes = (await one<{ m: number }>(env.DB, 'SELECT s.duration_minutes AS m FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id WHERE a.id=?', appointment.id))!.m
  let result
  try { result = await draftNote(state.config, t, minutes, dictation) }
  catch (e) { insist(false, (e instanceof ScribeError ? e.message : 'The AI model could not be reached.').replace(/\W+/g, '_').replace(/^_|_$/g, '').toLowerCase(), 424) }
  const note = await createNote(env.DB, who, { clientId: client.id, appointmentId: appointment.id, template: t.key, sections: result!.sections, charges: result!.charges }, 'scribe', result!.note)
  return { ...note, scribeNote: result!.note }
}

export async function scribeCommand(env: Bindings, who: Actor, name: string, input: Data) {
  if (name === 'scribe.save') return save(env, who, input)
  if (name === 'scribe.remove') return remove(env, who)
  if (name === 'scribe.check') return check(env, who)
  return draft(env, who, input)
}
