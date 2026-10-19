// NPPES NPI Registry lookup (https://npiregistry.cms.hhs.gov/api, version 2.1). The
// request carries only the NPI a person typed; nothing about the patient leaves Balm.
import { DomainError, insist } from '../domain/model'
import { validNpi } from '../payments/codes'

export const NPPES = 'https://npiregistry.cms.hhs.gov/api/'
export type Registered = { npi: string; name: string; credential: string; kind: 'individual' | 'organization'; taxonomy: string; address: string; phone: string; fax: string; retrievedAt: string }

/** The registry's current record for one NPI, or a refusal naming why none was read. */
export async function lookupNpi(npi: string): Promise<Registered> {
  insist(validNpi(npi), 'the_referring_npi_is_not_a_valid_npi')
  let body: any
  try {
    const response = await fetch(`${NPPES}?version=2.1&number=${npi}`, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(String(response.status))
    body = await response.json()
  } catch { throw new DomainError('npi_registry_unavailable', 424) }
  const found = body?.results?.find((r: any) => String(r.number) === npi)
  insist(found, 'npi_not_found_in_nppes', 404)
  const basic = found.basic ?? {}, organization = found.enumeration_type === 'NPI-2'
  const location = (found.addresses ?? []).find((a: any) => a.address_purpose === 'LOCATION') ?? found.addresses?.[0] ?? {}
  const taxonomy = (found.taxonomies ?? []).find((t: any) => t.primary) ?? found.taxonomies?.[0]
  const words = (list: unknown[]) => list.map(x => String(x ?? '').trim()).filter(Boolean).join(' ')
  return {
    npi, kind: organization ? 'organization' : 'individual', credential: organization ? '' : String(basic.credential ?? '').trim(),
    name: organization ? String(basic.organization_name ?? '').trim() : words([basic.name_prefix, basic.first_name, basic.middle_name, basic.last_name]),
    taxonomy: taxonomy ? words([taxonomy.code, taxonomy.desc && `· ${taxonomy.desc}`]) : '',
    address: words([location.address_1, location.address_2, location.city && `${location.city},`, location.state, String(location.postal_code ?? '').slice(0, 5)]),
    phone: String(location.telephone_number ?? ''), fax: String(location.fax_number ?? ''), retrievedAt: new Date().toISOString(),
  }
}
