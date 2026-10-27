import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { viewportProof } from './viewport-proof.mjs'
import { clinic } from './clinic.mjs'
import { customFields } from './migration-agent-journey.mjs'
import { cutoverInventory } from './movein-reconciliation-journey.mjs'

const h = await harness({ browserHttps: true })
try {
  await h.finishSetup()
  await clinic(h)
  const input = cutoverInventory()
  input.files = customFields(input.files)
  {
    const upload = async page => {
      await page.goto(h.origin + '/app/import')
      await page.locator('select[name=provider]').selectOption(input.provider)
      const patient = input.files.find(f => f.kind === 'patients')
      await page.locator('input[name=patients]').setInputFiles({ name: patient.name, mimeType: 'text/csv', buffer: Buffer.from(patient.csv) })
      for (const file of input.files.filter(f => f.kind !== 'patients')) await page.locator('input[name=' + file.kind + ']').setInputFiles({ name: file.name, mimeType: 'text/csv', buffer: Buffer.from(file.csv) })
      await page.getByRole('button', { name: 'Preview move-in', exact: true }).click()
      await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
      await page.locator('input[name=expectedInvoices]').fill('2')
      await page.getByRole('button', { name: 'Check totals again', exact: true }).click()
      await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
    }
    await viewportProof(h, [{ name: 'migration-mapping', path: '/app/import', cookie: h.owner, selector: 'h3:text-is("Check your totals before switching")', interact: async ({ page, width }) => {
      await upload(page)
      assert.equal(await page.locator('input[name=mappingApproval]').isChecked(), false)
      assert.equal(await page.locator('input[name=cutoverApproval]').isChecked(), false)
      if (width === 1440) for (const key of ['Invoices', 'Authorizations', 'Claims']) {
        assert.equal(await page.locator('input[name=expected' + key + ']').inputValue(), key === 'Invoices' ? '2' : '1')
        assert.equal(await page.locator('tr').filter({ has: page.locator('input[name=expected' + key + ']') }).locator('td').last().textContent(), '0')
      }
    } }])
    await viewportProof(h, [{ name: 'migration-approved-cutover', path: '/app/import', cookie: h.owner, selector: 'section:has(> h2:text-is("Saved reconciliation"))', interact: async ({ page, width }) => {
      await upload(page)
      await page.locator('input[name=mappingApproval]').check()
      await page.locator('input[name=cutoverApproval]').check()
      await page.locator('textarea[name=acceptanceReason]').fill('Owner reviewed the three source inventories and kept their original records; invoices, usable authorizations and claims still need to be carried separately.')
      await page.getByRole('button', { name: 'Apply move-in', exact: true }).click()
      await page.getByRole('heading', { name: 'Saved reconciliation', exact: true }).waitFor()
      if (width === 1440) for (const label of ['Invoices', 'Carried authorizations', 'Carried open claims']) assert.deepEqual(await page.locator('section:has(> h2:text-is("Saved reconciliation")) tr').filter({ has: page.getByText(label, { exact: true }) }).locator('td').allTextContents(), [label, label === 'Invoices' ? '2' : '1', '0'])
    } }])
  }
  await viewportProof(h, [{ name: 'migration-key-scope', path: '/app/agent', cookie: h.owner, selector: 'select[name=scopes]', interact: async ({page}) => { await page.locator('select[name=scopes]').selectOption('migration.prepare') } }])
  console.log('PASS migration mapping, explicit owner approval and saved cutover at 1440 and 390')
} finally { await h.close() }
