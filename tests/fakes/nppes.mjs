// The NPPES NPI Registry API at the network edge (version 2.1 response shape).
// `registry` maps an NPI to its basic/taxonomy/address record, or to an HTTP status
// to answer with; `calls` records each NPI asked for.
export function nppesRegistry(registry, calls = []) {
  return async request => {
    const url = new URL(request.url)
    if (url.origin + url.pathname !== 'https://npiregistry.cms.hhs.gov/api/') throw new Error(`Unexpected outbound request: ${request.method} ${request.url}`)
    const npi = url.searchParams.get('number'); calls.push({ npi, version: url.searchParams.get('version') })
    const record = registry[npi]
    if (typeof record === 'number') return new Response('unavailable', { status: record })
    return Response.json(record ? { result_count: 1, results: [{ number: Number(npi), ...record }] } : { result_count: 0, results: [] })
  }
}
export const individual = (first, last, credential, taxonomy, city) => ({ enumeration_type: 'NPI-1', basic: { first_name: first, last_name: last, credential },
  taxonomies: [{ code: taxonomy[0], desc: taxonomy[1], primary: true }], addresses: [{ address_purpose: 'LOCATION', address_1: '1 Clinic Way', city, state: 'TX', postal_code: '787010000', telephone_number: '512-555-0100', fax_number: '512-555-0101' }] })
