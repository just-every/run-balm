import { day, guard, insist, one, rows } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import type { Code } from '../charting/cpt'
import { releaseAt } from './catalog'

/** Descriptors and timing come only from this deployment's licensed release.
 * An empty catalog is useful for an honest setup screen, never for charging. */
export async function resolveChargeCatalog(db: D1Database, date?: string): Promise<Code[]> {
  const settings = date ? null : await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  if(!date&&!settings?.time_zone)return []
  const on = day(date ?? hostDateAt(new Date(), String(settings!.time_zone)), 'date_of_service')
  const release = await releaseAt(db, 'cpt', on)
  if (!release) return []
  const items = await rows(db, `SELECT code,description,timed FROM bm_code_items WHERE release_id=?
    AND effective_on<=? AND (deleted_on IS NULL OR deleted_on>?) ORDER BY code`, release.id, on, on)
  const hcpcs=await releaseAt(db,'hcpcs',on)
  const official=hcpcs?await rows(db,'SELECT code,description FROM bm_code_items WHERE release_id=? AND effective_on<=? AND (deleted_on IS NULL OR deleted_on>?)',hcpcs.id,on,on):[]
  const provenance=(r:typeof release)=>({id:r!.id,version:r!.version,effectiveOn:r!.effective_on})
  return items.flatMap<Code>(item => {
    insist(item.timed === 0 || item.timed === 1, 'licensed_cpt_requires_reviewed_timing')
    if(/^[A-Z]\d{4}$/.test(item.code)){
      const row=official.find(code=>code.code===item.code)
      // HCPCS descriptions and validity come from CMS. Timing is never guessed:
      // the owner must include a reviewed row in the private charge catalog.
      return hcpcs&&row?[{code:item.code,description:row.description,timed:item.timed===1,release:provenance(hcpcs),timingRelease:provenance(release)}]:[]
    }
    return [{ code: item.code, description: item.description, timed: item.timed === 1, release: provenance(release) }]
  })
}

/** New revisions use their visit's local service date. Guard the release epoch
 * in the same write, so a concurrent catalog update cannot change the answer. */
export async function noteChargeCatalog(db: D1Database, appointmentId?: string | null) {
  const epoch = await one(db, 'SELECT version FROM bm_code_epoch WHERE id=1')
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  const visit = appointmentId ? await one(db, 'SELECT start_at FROM bm_appointments WHERE id=?', appointmentId) : null
  insist(!appointmentId || visit, 'appointment_not_found', 404)
  const date = hostDateAt(visit ? new Date(visit.start_at) : new Date(), String(settings!.time_zone))
  return { date, items: await resolveChargeCatalog(db, date),
    guard: guard(db, '(SELECT version FROM bm_code_epoch WHERE id=1)=?', epoch!.version) }
}
