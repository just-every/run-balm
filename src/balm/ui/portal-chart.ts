import { empty, entry, field, form, h, hidden, panel, stamp, textarea } from './shared'

/** Staff author patient-specific programs; clinical reads are scoped before rendering. */
export function portalChartPanel(state: any, file: any) {
  if (!file.homeExercises) return ''
  const path = `/app/clients/${file.client.id}`
  const assignments = file.homeExercises.map((e: any) => entry(e.title,
    `<p>${h(e.sets)} sets · ${h(e.reps)} reps</p><p class="secure-body">${h(e.instructions)}</p>`
    + (e.image ? `<img class="exercise-image" src="${h(e.image)}" alt="${h(e.title)}">` : '')
    + `<p class="help">${e.seenAt ? `Opened ${stamp(state, e.seenAt)}.` : 'Not opened yet.'} ${e.doneDates?.length ? `Completed on ${e.doneDates.map((d: string) => h(d)).join(', ')}.` : 'No completion logged yet.'}</p>`
    + (!e.archivedAt ? form('exercise.archive', path, hidden('id', e.id), 'Archive exercise', true) : '<p>Archived</p>'))).join('')
  const assign = `<form method="post" enctype="multipart/form-data" action="/app/action?name=exercise.assign&amp;returnTo=${encodeURIComponent(path)}">${hidden('clientId', file.client.id)}
    ${field('title', 'Exercise name', '', 'text', 'required maxlength="160"')}
    <div class="pair">${field('sets', 'Sets', 3, 'number', 'required min="1" max="50"')}${field('reps', 'Reps', 10, 'number', 'required min="1" max="500"')}</div>
    ${textarea('instructions', 'Instructions and frequency', '', 'required maxlength="5000"')}
    <label>Instruction image (optional, PNG, JPEG or WebP, up to 1 MB)<input type="file" name="exerciseImage" accept="image/png,image/jpeg,image/webp"></label>
    <button type="submit">Assign exercise</button></form>`
  return panel('Home exercise program', `<p>Patients open their home program, visits, forms, messages and statements at <a href="/portal">the patient portal</a>, using an emailed sign-in link.</p>${assignments || empty('No home exercises assigned yet.')}<details><summary>Assign an exercise</summary>${assign}</details>`, 'full')
}
