import worker from './worker'
import authority from './communication-worker'
// The normal scheduler plus the existing native authority-revocation test boundary.
export default { ...worker, fetch: authority.fetch }
