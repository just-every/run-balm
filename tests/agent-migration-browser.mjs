import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { viewportProof } from './viewport-proof.mjs'
import { clinic } from './clinic.mjs'
import { customFields } from './migration-agent-journey.mjs'
import { cutoverInventory, cutoverClaims, cutoverAuthorizations } from './movein-reconciliation-journey.mjs'

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
  const payer = await h.cmd('insurance.payer.save', { name: 'Synthetic carry payer', payerId: '60054' })
  const claims = cutoverClaims(payer.id)
  const uploadClaims = async page => {
    await page.goto(h.origin + '/app/import')
    for (const file of claims.files) await page.locator('input[name=' + file.kind + ']').setInputFiles({ name: file.name, mimeType: 'text/csv', buffer: Buffer.from(file.csv) })
    await page.getByRole('button', { name: 'Preview move-in', exact: true }).click()
    await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
  }
  await viewportProof(h, [{ name: 'migration-carried-claims-preview', path: '/app/import', cookie: h.owner, selector: 'tr:has(> td:text-is("Open claim carried"))', interact: async ({ page, width }) => {
    await uploadClaims(page)
    if (width === 1440) {
      assert.equal(await page.locator('input[name=expectedClaims]').inputValue(), '2')
      assert.equal(await page.locator('tr').filter({ has: page.locator('input[name=expectedClaims]') }).locator('td').last().textContent(), '2')
      assert.equal(await page.getByText('Open claim carried', { exact: true }).count(), 2)
      await page.locator('input[name="balance_synthetic-balm-610"]').fill('121.00')
      await page.getByRole('button', { name: 'Check totals again', exact: true }).click()
      await page.getByText('Carried claim balances must match the source aging exactly; this difference cannot be accepted.').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Apply move-in', exact: true }).count(), 0)
      await uploadClaims(page)
    }
  } }])
  await viewportProof(h, [{ name: 'migration-carried-claims-saved', path: '/app/import', cookie: h.owner, selector: 'section:has(> h2:text-is("Saved reconciliation"))', interact: async ({ page, width }) => {
    await uploadClaims(page)
    await page.locator('input[name=mappingApproval]').check()
    await page.locator('input[name=cutoverApproval]').check()
    await page.locator('textarea[name=acceptanceReason]').fill('Checked original aging and claim controls; preserve carried receivables and original source records.')
    await page.getByRole('button', { name: 'Apply move-in', exact: true }).click()
    await page.getByRole('heading', { name: 'Saved reconciliation', exact: true }).waitFor()
    if (width === 1440) assert.deepEqual(await page.locator('section:has(> h2:text-is("Saved reconciliation")) tr').filter({ has: page.getByText('Carried open claims', { exact: true }) }).locator('td').allTextContents(), ['Carried open claims', '2', '2'])
  } }])
  const authorizations = cutoverAuthorizations(payer.id)
  await viewportProof(h, [{ name: 'migration-carried-authorizations', path: '/app/import', cookie: h.owner, selector: 'tr:has(> td:text-is("Authorization carried"))', interact: async ({ page, width }) => {
    await page.goto(h.origin + '/app/import')
    for (const file of authorizations.files) await page.locator('input[name=' + file.kind + ']').setInputFiles({ name: file.name, mimeType: 'text/csv', buffer: Buffer.from(file.csv) })
    await page.getByRole('button', { name: 'Preview move-in', exact: true }).click()
    await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
    if (width === 1440) {
      assert.equal(await page.getByText('Authorization carried', { exact: true }).count(), 3)
      assert.deepEqual(await page.locator('tr').filter({ has: page.locator('input[name=expectedAuthorizations]') }).locator('td').last().textContent(), '3')
      assert.match(await page.locator('tr').filter({ has: page.getByText('Authorization carried', { exact: true }) }).first().textContent(), /2 visits at cutover/)
      const review = page.locator('section.movein-preview')
      for (const fact of ['Original allowance: 3 visits', 'Prior usage: 1 visits', 'Cutover: 2026-01-15', 'CPT scope: 97110', 'Reservation: 3 units per visit', 'Booking action: block', 'SYNTHETIC-BALM-636', 'Source family plan', 'synthetic-balm-651']) assert.ok((await review.textContent()).includes(fact), 'approval exposes ' + fact)
      assert.ok((await review.textContent()).includes('Carried authorizations create native policies and prevent undo immediately.'))
      assert.ok(!(await review.textContent()).includes('Undo removes the whole bundle'))

    }
  } }])
  await viewportProof(h, [{ name: 'migration-authorizations-saved', path: '/app/import', cookie: h.owner, selector: 'section:has(> h2:text-is("Saved reconciliation"))', interact: async ({ page, width }) => {
    await page.goto(h.origin + '/app/import')
    for (const file of authorizations.files) await page.locator('input[name=' + file.kind + ']').setInputFiles({ name: file.name, mimeType: 'text/csv', buffer: Buffer.from(file.csv) })
    await page.getByRole('button', { name: 'Preview move-in', exact: true }).click()
    await page.getByRole('heading', { name: 'Proposed field mapping', exact: true }).waitFor()
    await page.locator('input[name=mappingApproval]').check()
    await page.locator('input[name=cutoverApproval]').check()
    await page.locator('textarea[name=acceptanceReason]').fill('Reviewed original policy coverage, authorization allowances, prior usage and source cutover date.')
    await page.getByRole('button', { name: 'Apply move-in', exact: true }).click()
    await page.getByRole('heading', { name: 'Saved reconciliation', exact: true }).waitFor()
    if (width === 1440) assert.deepEqual(await page.locator('section:has(> h2:text-is("Saved reconciliation")) tr').filter({ has: page.getByText('Carried authorizations', { exact: true }) }).locator('td').allTextContents(), ['Carried authorizations', '3', '3'])
  } }])
  await viewportProof(h, [{ name: 'migration-key-scope', path: '/app/agent', cookie: h.owner, selector: 'select[name=scopes]', interact: async ({page}) => { await page.locator('select[name=scopes]').selectOption('migration.prepare') } }])
  console.log('PASS migration mapping, explicit owner approval and saved cutover at 1440 and 390')
} finally { await h.close() }
