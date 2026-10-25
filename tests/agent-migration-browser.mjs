import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { viewportProof } from './viewport-proof.mjs'
import { migrationAgentJourney } from './migration-agent-journey.mjs'

const h = await harness({ browserHttps: true })
try {
  await migrationAgentJourney(h, async ({ input, applied }) => {
    if (applied) return
    const upload = async page => {
      await page.goto(h.origin + '/app/import')
      await page.locator('select[name=provider]').selectOption(input.provider)
      const patient = input.files.find(f => f.kind === 'patients')
      await page.locator('input[name=patients]').setInputFiles({ name: patient.name, mimeType: 'text/csv', buffer: Buffer.from(patient.csv) })
      await page.getByRole('button', { name: 'Preview move-in', exact: true }).click()
      await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
    }
    await viewportProof(h, [{ name: 'migration-mapping', path: '/app/import', cookie: h.owner, selector: '.movein-preview', interact: async ({ page }) => {
      await upload(page)
      assert.equal(await page.locator('input[name=mappingApproval]').isChecked(), false)
      assert.equal(await page.locator('input[name=cutoverApproval]').isChecked(), false)
    } }])
    await viewportProof(h, [{ name: 'migration-approved-cutover', path: '/app/import', cookie: h.owner, selector: 'section:has(> h2:text-is("Saved reconciliation"))', interact: async ({ page }) => {
      await upload(page)
      await page.locator('input[name=mappingApproval]').check()
      await page.locator('input[name=cutoverApproval]').check()
      await page.locator('textarea[name=acceptanceReason]').fill('Owner reviewed the two unusual fields and kept their original export; only supported patient fields are imported.')
      await page.getByRole('button', { name: 'Apply move-in', exact: true }).click()
      await page.getByRole('heading', { name: 'Saved reconciliation', exact: true }).waitFor()
    } }])
  })
  console.log('PASS migration mapping, explicit owner approval and saved cutover at 1440 and 390')
} finally { await h.close() }
