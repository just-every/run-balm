// The schedule's one script, allowed by its hash: drag a booked visit onto a
// free time to move it (the server re-checks hours and overlaps, as the edit
// form does), and select an empty time to open the booking panel there.
export const dragScript = `(() => {
  const grid = document.querySelector('[data-calendar]'), form = document.getElementById('move-form')
  if (!grid || !form) return
  let dragged = null
  const clear = () => grid.querySelectorAll('.drop').forEach(cell => cell.classList.remove('drop'))
  grid.addEventListener('dragstart', event => {
    const visit = event.target.closest && event.target.closest('.appt[data-id]')
    if (!visit) return
    dragged = visit
    event.dataTransfer.setData('text/plain', visit.dataset.id)
    event.dataTransfer.effectAllowed = 'move'
    visit.classList.add('dragging')
  })
  grid.addEventListener('dragend', () => { if (dragged) dragged.classList.remove('dragging'); dragged = null; clear() })
  grid.addEventListener('dragover', event => {
    const cell = event.target.closest && event.target.closest('.cell')
    if (!dragged || !cell) return
    event.preventDefault()
    if (!cell.classList.contains('drop')) { clear(); cell.classList.add('drop') }
  })
  grid.addEventListener('drop', event => {
    const cell = event.target.closest && event.target.closest('.cell')
    if (!dragged || !cell) return
    event.preventDefault()
    const fields = form.elements
    fields.id.value = dragged.dataset.id
    fields.version.value = dragged.dataset.version
    fields.date.value = cell.dataset.date
    fields.time.value = cell.dataset.time
    const column = fields.roomId || fields.equipmentId || fields.practitionerId
    column.value = cell.dataset.col === 'none' ? '' : cell.dataset.col
    form.submit()
  })
  grid.addEventListener('click', event => {
    const cell = event.target.closest && event.target.closest('.cell[data-book]')
    if (cell) location.href = cell.dataset.book
  })
})()`
