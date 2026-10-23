# Install and update billing code sets

Balm keeps each imported release with its effective date, source, SHA-256, row count and next scheduled release. Claims select the latest completed release effective on their service date. Loading a later quarter does not change an earlier visit's tables. An interrupted import stays incomplete and is never used for billing.

The owner runs updates through Balm's authenticated command endpoint, `POST /api/balm/command`, with `{ "name": "codes.update", "input": ... }`. Use the same signed-in owner session as other Balm commands. This command fetches the files itself; it accepts only HTTPS downloads linked by the specified CMS release page. Archive redirects, encrypted archives, unexpected members, size mismatches and ZIP checksum failures are refused. An optional `sha256` on a file pins the expected archive bytes. CMS does not publish a cryptographic digest on these release pages: Balm's recorded digest identifies the downloaded official file and must not be represented as a CMS-signed checksum.

For a practitioner NCCI update, the input is:

```json
{
  "kind": "ptp",
  "version": "32.3 r0",
  "effectiveOn": "2026-10-01",
  "licenseAcknowledged": true,
  "licenseBasis": "Reference to this deployment's reviewed applicable CMS/AMA terms",
  "files": [
    {"url":"https://www.cms.gov/files/zip/medicare-ncci-2026q4-practitioner-ptp-edits-ccipra-v323r0-f1.zip"},
    {"url":"https://www.cms.gov/files/zip/medicare-ncci-2026q4-practitioner-ptp-edits-ccipra-v323r0-f2.zip"},
    {"url":"https://www.cms.gov/files/zip/medicare-ncci-2026q4-practitioner-ptp-edits-ccipra-v323r0-f3.zip"},
    {"url":"https://www.cms.gov/files/zip/medicare-ncci-2026q4-practitioner-ptp-edits-ccipra-v323r0-f4.zip"}
  ]
}
```

Use all four **complete practitioner** parts, not the hospital tables or quarterly change report. The native tab-separated file supplies column one, column two, prior-edit marker, effective date, deletion date and modifier indicator. Deleted edits stop applying on their deletion date; indicator 9 never generates an active edit. The modern four-part CMS filenames are supported; older file naming needs an explicit importer extension rather than being silently guessed.

Other official releases use the same command with one file:

| Kind | Complete native member read | Effective dates |
| --- | --- | --- |
| `icd10` | `icd10cm_order_YYYY.txt` from CMS Code Descriptions in Tabular Order ZIP; fixed-width code, header/billable flag, full description | October 1 and April updates |
| `hcpcs` | `HCPC*_ANWEB*.txt`; CMS fixed-width first/continuation records, long description, code-added and termination dates | January, April, July, October 1 |
| `mue` | `MCR_MUE_PractitionerServices*.csv`; code, unit limit and adjudication indicator | January, April, July, October 1 |

For example, October 2026 HCPCS is `https://www.cms.gov/files/zip/october-2026-alpha-numeric-hcpcs-file.zip`; FY2027 ICD-10-CM effective October 2026 is `https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip`; October 2026 practitioner MUE is `https://www.cms.gov/files/zip/medicare-ncci-2026-q4-practitioner-services-mue-table.zip`. For historical files, set `sourcePage` to the official CMS archive page linking that download. Import the complete replacement release, not an addendum.

MUE public files do not provide individual effective/deletion columns. Balm records each row's release effective date and chooses the complete snapshot for the service date; a removed row is absent from the later snapshot. MAI 1 is checked per line. MAI 2 and 3 total the code across the patient's same-day claims for the rendering practitioner. MAI 2 is absolute; an MAI 3 excess is a review finding, never automatically cleared by a modifier. Published MUEs do not disclose every CMS edit, so a local scrub cannot guarantee payer acceptance.

A successful update reports added, removed and changed rows. Running the same update again rechecks the official bytes and returns `duplicate: true, changed: false` without adding rows, releases or audit entries. Replacements with different bytes create a separate completed version and retain earlier records. Do not schedule automatic updates without the owner's authorization. A large complete NCCI import performs bounded sequential D1 writes; run one update at a time and keep the request connected until its completion receipt. Failed attempts remain visible as incomplete records.

## CPT licensing

**Balm distributes no CPT descriptors or CPT dataset.** Each deployment needs the appropriate [AMA CPT data license](https://www.ama-assn.org/practice-management/cpt/cpt-licensing-frequently-asked-questions-faqs). Reading a public CMS file is not a grant to redistribute the AMA's CPT content. NCCI downloads also carry CMS/AMA license terms; the owner records the deployment's applicable basis before loading PTP or MUE data. Balm does not accept those legal terms for the owner.

Import a private, licensed CPT export using `codes.cpt.import`. Supply `effectiveOn` (January 1), `version`, `licenseAcknowledged: true`, `licenseBasis`, UTF-8 `content`, and a `mapping` naming its code, descriptor and reviewed timed/untimed columns:

```json
{"separator":"\t","code":"Code","description":"Descriptor","timed":"Timed"}
```

These are owner-selected column names, not a claim about an AMA vendor's proprietary format. `Timed` must contain reviewed `1` for a timed procedure or `0` for an untimed procedure. Preserve the licensed descriptions exactly; export or normalize the licensed file privately if its vendor format differs. Neither Balm nor its tests supply a substitute CPT dataset. No licensed deployment file was available during implementation; acceptance against a real licensed CPT file remains an owner-data prerequisite.

## Search, specificity and distinct services

`codes.search` takes `kind`, `query` and service `date`. It searches code, description words and the owner's synonyms. `codes.synonym.save` takes `kind`, `code`, `term`; adding a synonym never changes the official code or makes a header billable. Header ICD-10-CM codes are refused by claim validation with their billable descendants and release version.

A clinician documents the pair, clinically distinct service rationale and selected modifier (`59`, `XE`, `XP`, `XS` or `XU`) in the exact note revision they sign. Only verified signed-note attestations enter claim validation. An indicator-1 edit proposes the attested modifier; it clears only after that modifier is explicitly applied to the second service. An indicator-0 edit stays refused. A checkbox or modifier added by a biller or agent cannot substitute for the clinician's attestation.

`codes.status` reports missing and overdue releases for the daily close. The next scheduled dates are quarterly for HCPCS/NCCI, October and April for ICD-10-CM, and January for CPT. Missing tables are named findings; no abbreviated built-in table is used as a replacement.

## Primary sources and format verification

Sources inspected 23 October 2026:

- [CMS ICD-10 releases](https://www.cms.gov/medicare/coding-billing/icd-10-codes): complete order file, including header flags. The FY2027 ZIP was inspected in memory.
- [CMS HCPCS quarterly updates](https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update): October 2026 ANWEB and the accompanying `HCPC2026_recordlayout.txt` were inspected in memory. Long descriptions use positions 12–91; type 4 continues type 3; added date 269–276; termination date 285–292.
- [CMS practitioner PTP releases](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits) and [CMS NCCI tools](https://www.cms.gov/outreach-and-education/mln/educational-tools/mln901346-how-to-use-the-medicare-ncci/ncci-medicare/chapter_2_using_the_ncci_tools/): full quarterly files and modifier/date semantics. The ungated Q4 2026 additions report names `00530 / 0932T`, indicator 1, as an addition; the two-release network-edge fixture uses that published change without redistributing a complete licensed table.
- [CMS practitioner MUEs](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits-mues) and [NCCI FAQ](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-faq-library): October 2026 native practitioner CSV was inspected in memory; MAI semantics come from CMS.
- [Cloudflare compression streams](https://developers.cloudflare.com/workers/runtime-apis/web-standards/#compression-streams): platform DEFLATE decoding for streamed ZIP members.
