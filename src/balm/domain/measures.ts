// CHART-005: the author records structured measures in their own unsigned note.
// Measures are read with the note they belong to, so the owner, the author, a
// care-team grant and open break glass (CHART-013) read them under the note's own
// read audit; nobody else does.
import { pendingSubmission } from './supervision'
import { gradeValue, measureKinds, sides, type MeasureKind } from '../charting/measures'
import { audit, commit, guard, human, id, insist, integer, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'

async function ownDraft(db: D1Database, who: Actor, noteId: unknown) {
  human(who)
  const note = await one(db, 'SELECT * FROM bm_notes WHERE id=?', text(noteId, 'note', 100))
  insist(note && note.author_id === practitionerId(who), 'note_not_found', 404)
  insist(!note.signed_at, 'note_signed_add_an_addendum', 409)
  insist(!await pendingSubmission(db,note.id),'note_waiting_for_supervisor',409)
  return note
}

export async function recordMeasure(db: D1Database, who: Actor, input: Data) {
  const note = await ownDraft(db, who, input.noteId)
  const kind = text(input.kind, 'measure_kind', 20) as MeasureKind, spec = measureKinds[kind]
  insist(spec, 'unknown_measure_kind')
  const name = text(input.name, 'measure_name', 80), side = input.side ? text(input.side, 'side', 10) : 'none'
  insist((sides as readonly string[]).includes(side), 'unknown_side')
  const unit = input.unit ? text(input.unit, 'unit', 20) : spec.units[0]
  insist(spec.units.includes(unit), 'unit_not_allowed_for_measure')
  const raw = String(input.value ?? '').trim()
  const value = kind === 'mmt' ? gradeValue(raw) : /^-?\d{1,5}(\.\d{1,2})?$/.test(raw) ? Number(raw) : null
  insist(value !== null && value >= spec.min && value <= spec.max, kind === 'mmt' ? 'enter_a_muscle_grade_0_to_5' : 'measure_value_out_of_range')
  const flow = kind === 'flowsheet'
  const sets = flow ? integer(input.sets, 'sets', 1, 100) : null, reps = flow ? integer(input.reps, 'reps', 1, 1000) : null
  const measureId = id()
  await commit(db, who, [
    guard(db, 'EXISTS(SELECT 1 FROM bm_notes WHERE id=? AND signed_at IS NULL)', note.id),
    stmt(db, 'INSERT INTO bm_measures(id,note_id,client_id,kind,name,side,value,unit,sets,reps,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      measureId, note.id, note.client_id, kind, name, side, value, unit, sets, reps, note.author_id, now()),
    audit(db, who, 'note.measured', note.client_id as string, note.id as string, spec.label),
  ])
  return { id: measureId, noteId: note.id, kind, name, side, value, unit, sets, reps }
}

export async function removeMeasure(db: D1Database, who: Actor, input: Data) {
  const measure = await one(db, 'SELECT * FROM bm_measures WHERE id=?', text(input.id, 'measure', 100))
  insist(measure, 'measure_not_found', 404)
  const note = await ownDraft(db, who, measure.note_id)
  await commit(db, who, [
    stmt(db, 'DELETE FROM bm_measures WHERE id=? AND note_id=?', measure.id, note.id), guard(db, 'changes()=1'),
    audit(db, who, 'note.measure_removed', note.client_id as string, note.id as string, measureKinds[measure.kind as MeasureKind].label),
  ])
  return { id: measure.id, removed: true }
}

/** Measures of the notes a reader already reaches, in entry order. */
export async function measuresOf(db: D1Database, noteIds: string[]) {
  if (!noteIds.length) return []
  return rows(db, `SELECT id,note_id,kind,name,side,value,unit,sets,reps,recorded_at FROM bm_measures WHERE note_id IN (${noteIds.map(() => '?').join(',')}) ORDER BY recorded_at,id`, ...noteIds)
}
