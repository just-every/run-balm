// On this computer, rer's dev key gate admits only browsers that opened Balm
// with the RER_OPEN link, and links minted there count only in such a browser
// (src/modules/operator-auth/dev-admission.mjs). Anywhere else the auth module
// would call a good invitation "invalid or expired"; this page says what to do.
import type { Bindings } from '../auth.server'
import { devAdmitted } from '../modules/operator-auth/dev-admission.mjs'
import { renderPublic } from './ui'

export async function localLinkResponse(request: Request, env: Bindings): Promise<Response | null> {
  if (env.AUTH_LOCAL !== 'true' || env.RER_DEMO === '1' || (env as any).RER_DEV_IDENTITY === 'off') return null
  if (new URL(request.url).pathname !== '/auth/confirm' || !['GET', 'HEAD'].includes(request.method)) return null
  if (await devAdmitted(request)) return null
  return renderPublic('local-link', {}, 403)
}
