import { harness } from './harness.mjs'
import { viewportProof } from './viewport-proof.mjs'
import { outcomeFollowthroughJourney } from './outcome-followthrough-journey.mjs'

const h = await harness({ browserHttps: true })
try {
  await outcomeFollowthroughJourney(h, async ({ stage, patientCookie, priya, filePath, note }) => {
    const patient = stage === 'patient-request'
    await viewportProof(h, [{ name: 'outcome-' + stage, path: patient ? '/portal/home' : filePath,
      cookie: patient ? patientCookie : priya.cookie,
      selector: patient ? 'section:has-text("Your clinic updates")' : stage === 'edited-report' ? '#note-' + note.id : '#outcome-followthrough' }])
  })
  console.log('PASS outcome requests, clinician brief and edited progress report at 1440 and 390')
} finally { await h.close() }
