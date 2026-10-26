import assert from 'node:assert/strict'

export const mappingKeys = ['receivable', 'income', 'card', 'era', 'cash', 'external', 'bank', 'fees', 'adjustments', 'liability', 'tax']
export const accountingMappings = Object.fromEntries(mappingKeys.map((key, i) => [key, String(i + 1)]))

export function quickbooksEdge() {
  const journals = new Map(), requests = new Map(), writes = []
  let loseResponse = false
  return { journals, requests, writes,
    loseNextResponse() { loseResponse = true },
    async outbound(request) {
      const url = new URL(request.url)
      if (url.hostname === 'oauth.platform.intuit.com') return Response.json({ access_token: 'synthetic-balm-11', refresh_token: 'synthetic-balm-12', expires_in: 3600 })
      assert.equal(url.origin, 'https://sandbox-quickbooks.api.intuit.com')
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic-balm-11')
      if (url.pathname.endsWith('/companyinfo/123')) return Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic Balm Books' } })
      if (url.pathname.endsWith('/query')) {
        if (url.searchParams.get('query').includes('JournalEntry')) {
          const document = url.searchParams.get('query').match(/DocNumber = '([^']+)'/)[1]
          return Response.json({ QueryResponse: { JournalEntry: [...journals.values()].filter(j => j.DocNumber === document) } })
        }
        return Response.json({ QueryResponse: { Account: ['Patient receivable control', 'Therapy service income', 'Card clearing', 'Insurance remittances', 'Cash on hand', 'External receipts', 'Operating bank', 'Merchant processing fees', 'Contractual adjustments', 'Gift balances', 'Sales tax payable'].map((Name, i) => ({ Id: String(i + 1), Name, AccountType: i === 1 ? 'Income' : i === 6 ? 'Bank' : [7,8].includes(i) ? 'Expense' : i > 8 ? 'Other Current Liability' : 'Other Current Asset' })) } })
      }
      if (request.method === 'POST' && url.pathname.endsWith('/journalentry')) {
        const body = await request.json(), requestId = url.searchParams.get('requestid')
        assert.ok(requestId)
        if (requests.has(requestId)) { assert.deepEqual(requests.get(requestId).body, body); return Response.json({ JournalEntry: requests.get(requestId).journal }) }
        const Id = String(journals.size + 1), journal = { ...body, Id, SyncToken: '0' }
        journals.set(Id, journal); requests.set(requestId, { body, journal }); writes.push(body)
        if (loseResponse) { loseResponse = false; throw new Error('Synthetic lost response after provider commit') }
        return Response.json({ JournalEntry: journal })
      }
      const journal = journals.get(url.pathname.split('/').at(-1))
      assert.ok(journal, 'readback uses the provider journal identity')
      return Response.json({ JournalEntry: journal })
    },
  }
}
