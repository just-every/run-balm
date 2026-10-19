// Note saves survive a dropped connection only in this open tab. The command
// and its request id stay immutable until the server confirms the revision.
export const noteDraftScript = `(() => {
  const commandOf = form => {
    const url = new URL(form.action, location.href)
    return url.origin === location.origin && url.pathname === '/app/action' ? url.searchParams.get('name') : null
  }
  const forms = [...document.forms]
  const noteForms = forms.filter(form => ['note.write', 'note.amend'].includes(commandOf(form)))
  if (!noteForms.length) return

  const inputOf = form => Object.fromEntries(new FormData(form))
  const fingerprint = form => JSON.stringify([...new FormData(form)].map(([name, value]) =>
    [name, typeof value === 'string' ? value : value.name ? [value.name, value.size, value.type, value.lastModified] : null]))
  // Revision metadata changes after confirmation, without changing the text.
  const noteFingerprint = input => JSON.stringify(Object.entries(input).filter(([name]) =>
    !['id', 'revision', 'requestId'].includes(name)))
  const initial = new Map(forms.map(form => [form, fingerprint(form)]))
  const states = noteForms.map(form => {
    const status = document.createElement('p')
    status.className = 'help'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.setAttribute('aria-atomic', 'true')
    form.append(status)
    return { form, status, actor: form.dataset.actorId, baseline: noteFingerprint(inputOf(form)),
      pending: null, enqueued: false, blocked: false, conflict: false, phase: 'saved',
      returnTo: new URL(form.action, location.href).searchParams.get('returnTo') }
  })
  const queue = []
  let active = null
  let nativeSubmission = null
  const dirty = state => noteFingerprint(inputOf(state.form)) !== state.baseline
  const changedSinceSave = state => state.pending && noteFingerprint(inputOf(state.form)) !== state.pending.fingerprint
  const setStatus = (state, phase, text) => {
    state.phase = phase
    state.status.dataset.noteDraftState = phase
    state.status.textContent = text
    state.form.setAttribute('aria-busy', phase === 'saving' ? 'true' : 'false')
  }
  const authStatus = state => {
    setStatus(state, 'auth', 'Sign in in another tab as the original author, then select Save draft. Your text remains in this tab. ')
    const link = document.createElement('a')
    link.href = '/signin?returnTo=' + encodeURIComponent(location.pathname + location.search + location.hash)
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = 'Sign in in another tab'
    state.status.append(link)
  }
  const blockAuthentication = () => {
    // A Save selected before the refusal is not fresh authorization to replay
    // after sign-in. Each form must receive another explicit submit.
    for (const job of queue.splice(0)) job.state.enqueued = false
    for (const state of states) {
      state.blocked = true
      if (state.pending || dirty(state)) authStatus(state)
    }
  }
  const queuedStatus = state => setStatus(state, 'queued',
    'Save is queued in this open tab. Balm will retry it when you reconnect, or when you select Save draft.' +
    (changedSinceSave(state) ? ' Later edits are still unsaved; save them after this request is confirmed.' : ''))
  const conflictStatus = state => setStatus(state, 'conflict',
    'This note changed or was signed elsewhere. Your text remains here and will not overwrite it. Open the current note in another tab to compare before making a new revision.')
  const editStatus = state => {
    if (state.conflict) return conflictStatus(state)
    if (state.blocked) return authStatus(state)
    if (state.phase === 'queued') return queuedStatus(state)
    if (state.phase === 'saving') {
      setStatus(state, 'saving', 'Saving draft.' + (changedSinceSave(state) ? ' Later edits remain visible and must be saved after this request is confirmed.' : ''))
      return
    }
    if (state.pending) {
      setStatus(state, 'error', 'The last save is unconfirmed. Select Save draft to check that same request. Later edits remain in this tab.')
      return
    }
    setStatus(state, dirty(state) ? 'unsaved' : 'saved', dirty(state)
      ? (navigator.onLine ? 'Unsaved changes in this tab.' : 'Offline. Unsaved changes remain in this tab. Select Save draft to queue them.')
      : 'No unsaved changes.')
  }
  const hasUnsavedWork = () => forms.some(form => {
    if (form === nativeSubmission) return false
    const state = states.find(item => item.form === form)
    return state ? dirty(state) || !!state.pending || state.enqueued : fingerprint(form) !== initial.get(form)
  })
  const updateHidden = (form, name, value) => {
    let field = form.querySelector('input[type="hidden"][name="' + name + '"]')
    if (!field) {
      field = document.createElement('input')
      field.type = 'hidden'
      field.name = name
      form.append(field)
    }
    field.value = String(value)
  }
  const httpError = async (state, response, command) => {
    if (response.status === 401 || response.status === 403) {
      blockAuthentication()
      authStatus(state)
      return
    }
    if (command && response.status === 409) {
      state.conflict = true
      conflictStatus(state)
      return
    }
    let message = 'Balm refused this save (' + response.status + ').'
    try {
      const body = await response.json()
      if (typeof body.error === 'string') message = body.error
    } catch (_) { /* An HTTP refusal is not a dropped transport. */ }
    // A server error may follow a committed write; retain its immutable request.
    if (command && response.status >= 400 && response.status < 500) state.pending = null
    setStatus(state, 'error', message + ' Your text remains here. Select Save draft to try again.')
  }
  const transportFailure = state => {
    if (state.blocked) authStatus(state)
    else queuedStatus(state)
  }
  const send = async state => {
    setStatus(state, 'saving', 'Checking sign-in and saving draft.')
    if (!state.actor) {
      blockAuthentication()
      authStatus(state)
      return
    }
    // Check the live actor before every attempt, including recovery and explicit
    // retry. A new session must never replay the previous author's clinical text.
    let identity
    try {
      identity = await fetch('/api/balm/state', { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } })
    } catch (_) { transportFailure(state); return }
    if (!identity.ok) { await httpError(state, identity, false); return }
    let live
    try { live = await identity.json() }
    catch (error) {
      if (error instanceof TypeError) transportFailure(state)
      else setStatus(state, 'error', 'Could not confirm your sign-in. Your text remains here. Select Save draft to try again.')
      return
    }
    if (live?.actor?.id !== state.actor) {
      blockAuthentication()
      authStatus(state)
      return
    }
    state.blocked = false
    const pending = state.pending
    let response
    try {
      response = await fetch('/api/balm/command', { method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: pending.name, input: pending.input }) })
    } catch (_) { transportFailure(state); return }
    if (!response.ok) { await httpError(state, response, true); return }
    let body
    try { body = await response.json() }
    catch (error) {
      if (error instanceof TypeError) transportFailure(state)
      else setStatus(state, 'error', 'The save response could not be confirmed. Your text remains here. Select Save draft to check the same request.')
      return
    }
    const result = body?.result
    if (!result || typeof result.id !== 'string' || !Number.isInteger(result.revision) || result.revision < 1) {
      setStatus(state, 'error', 'The saved revision could not be confirmed. Your text remains here. Select Save draft to check the same request.')
      return
    }
    const action = new URL(state.form.action, location.href)
    action.searchParams.set('name', 'note.amend')
    state.form.action = action.href
    updateHidden(state.form, 'id', result.id)
    updateHidden(state.form, 'revision', result.revision)
    state.baseline = pending.fingerprint
    state.pending = null
    if (dirty(state)) {
      setStatus(state, 'unsaved', 'Earlier changes saved. Your later edits remain here; select Save draft to save them.')
      return
    }
    setStatus(state, 'saved', 'Saved. Your draft is not signed.')
    if (!hasUnsavedWork() && state.returnTo) {
      const target = new URL(state.returnTo, location.href)
      if (target.origin === location.origin) location.assign(target.href)
    }
  }
  const drain = async () => {
    if (active) return
    while (queue.length) {
      const job = queue.shift(), state = job.state
      state.enqueued = false
      if (state.conflict || (job.automatic && state.blocked)) continue
      if (!navigator.onLine) { transportFailure(state); continue }
      active = state
      try { await send(state) }
      catch (_) { setStatus(state, 'error', 'Could not confirm this save. Your text remains here. Select Save draft to check the same request.') }
      finally { active = null }
    }
  }
  const requestSave = (state, automatic = false) => {
    if (state.conflict) { conflictStatus(state); return }
    if (automatic && state.blocked) return
    if (active === state || state.enqueued) return
    if (!state.pending) {
      const input = inputOf(state.form)
      state.pending = { name: commandOf(state.form), fingerprint: noteFingerprint(input),
        input: { ...input, expectedActorId: state.actor, requestId: crypto.randomUUID() } }
    }
    if (!navigator.onLine) { transportFailure(state); return }
    state.enqueued = true
    queue.push({ state, automatic })
    setStatus(state, 'saving', 'Waiting to save draft.')
    void drain()
  }
  for (const state of states) {
    editStatus(state)
    state.form.addEventListener('input', () => editStatus(state))
    state.form.addEventListener('change', () => editStatus(state))
    state.form.addEventListener('reset', () => queueMicrotask(() => editStatus(state)))
    state.form.addEventListener('submit', event => {
      event.preventDefault()
      requestSave(state)
    })
  }
  document.addEventListener('submit', event => {
    if (!noteForms.includes(event.target)) nativeSubmission = event.target
  })
  addEventListener('online', () => {
    for (const state of states) if (state.pending && state.phase === 'queued' && !state.blocked) requestSave(state, true)
  })
  addEventListener('offline', () => {
    for (const state of states) if (state.phase !== 'saving') editStatus(state)
  })
  addEventListener('beforeunload', event => {
    if (!hasUnsavedWork()) return
    event.preventDefault()
    event.returnValue = ''
  })
})()`
