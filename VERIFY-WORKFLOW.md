# Adopt the seed Verify workflow

Foundation compositions and standalone reference exports receive the two
workflows from Base's export templates, the verification manifest and its
helpers. Existing editions merge these changes into their owned workflows,
preserving product checks, package pins and the stable `verify` aggregate.

| Entry | Coverage |
| --- | --- |
| Branch push, pull request, Verify dispatch | Push shards, unless qualified reuse or light coverage applies |
| Monday and Thursday schedule | Nightly shards only |
| Release tag beginning with `v` | Every push and nightly shard, always |
| Nightly journeys dispatch | Every push and nightly shard |

Verify retains unrestricted branch pushes and pull requests. Main's concurrency
key contains its run ID, so main runs cannot replace one another. Other refs
cancel superseded runs. Event names separate PR planning from its branch push
producer and separate scheduled and manual runs.

The workflows use Ubuntu 24.04. Keep that image and the edition's exact Node,
pnpm and frozen lockfile pins. The final aggregate requires successful planning
and the selected coverage. It accepts a skipped matrix only when the planner
explicitly selected reuse, light coverage, or an empty nightly selection. Failed
and cancelled work cannot pass the aggregate.

## Balm adoption

Balm adopts the verification lifecycle from rer 0.2.86 / Base
`f96363bf919ea3e7ed1837daba6894810a50e4a6`. Its existing
`verification.json` remains the source of product coverage: source and generated
contract checks, typecheck, the hosted runtime/browser checks, domain and billing
checks, and all four portability partitions stay in push coverage. The
`owned-clean-start` browser journey stays in nightly coverage. No commands or
assertions are removed by this workflow adoption.

Push coverage uses eight shards. Source runs typecheck, then the Balm,
schedule, reminders, move-in and retention test files before its source and
generated-contract checks. Those five whole files move from domain; their
351.8 seconds in Verify 41718952920 balance its previously idle source runner.
Tests precede generated-view checks so stale lander-owned views cannot prevent
product journeys from running. Portability core owns the general round trip and
erasure journals; authorizations also owns the continuity and institutional
originals round trips. Backups includes readiness and booking-prepayment
archives; roles retains both jobs-preservation cases and the retail case.
Every archive case runs in exactly one partition with every existing assertion,
test timeout retained. The job limit is 13 minutes for the measured reason
below.

### Archive fixture cost and shard measurements

Durations below include runner setup and cleanup, not just the test process.
Main's domain result is its successful retry; its other shards are attempt 1.
The first rebalance already combined typecheck into source and readiness into
backups. It moved work between jobs without removing repeated fixture cost.

| Shard | Main Verify 41686109554 (job) | First rebalance Verify 41718952920 (job) |
| --- | --- | --- |
| source | 0:26 (126111429373) | 0:39, generated-view failure (126206443152) |
| typecheck | 0:43 (126111381369) | included in source |
| runtime | 8:10 (126111468209) | 8:09 (126206442973) |
| domain | 11:43 (126111381180) | 11:43 (126206443145) |
| domain-billing | 10:18 (126111431550) | 7:26 (126206443008) |
| portability-core | 10:45 (126111431099) | 8:42 (126206443115) |
| portability-backups | 3:51 (126111451873) | 10:16 (126206443026) |
| portability-readiness | 4:30 (126111382749) | included in backups |
| portability-roles | 10:50 (126111382296) | 12:00, cancelled (126206443275) |
| portability-authorizations | 6:49 (126111474028) | 10:39 (126206443031) |

The slowest rebalance cases were automatic backup/recovery (306.0 seconds),
the general cold archive round trip (272.2), retail (240.0, timed out),
jobs/signatures (225.9), erasure journals (216.7), and manual EOB (215.7).
Main's retail case took 221.5 seconds: export 40.4 and import 127.8. On the
rebalance it spent 47.2 in export and 142.8 in import; the latter completed only
after the case's 240-second deadline. Domain's slowest individual cases were
quiet hours (26.6), reminders (26.5), retention (25.9), and Cliniko cutover
(18.3), rather than one stalled case.

Wrangler 4.129.1 applies each pending file through a fresh Miniflare proxy.
The old roles fixtures ran all 142 migrations that way in their source, then
CLI import repeated the cold apply in each destination. The fixture now uses
the existing harness's real per-file SQL transactions and migration ledger in
one Worker, including unclaimed empty destinations. Migration 0141 itself
measured 77.6 ms in a local per-migration probe; it adds to repeated history
setup rather than introducing a pathological retail query. No migration bytes,
product transfer path, provider behavior or archive assertions change.

The general round-trip destination and automatic backup scratch destination
still start without a database, covering the public CLI's cold migration path.
Damaged and occupied-target refusal, erasure fences, native ledger validation,
real export/import and Worker disposal remain covered. Other destinations are
unclaimed, migrated empty installations; no clinic fixture data is copied into
them. This extends the existing call-custody fixture strategy.

With at most two local check processes on the four-core cloud VM, the repaired
roles partition passed all three cases in 472.6 seconds. Jobs/signatures took
154.1 seconds, manual EOB 142.0, and retail 175.4, retaining the latter's
240-second limit. The five moved domain files passed all 38 cases in 416.5
seconds. These are local fixture checks; the branch's exact-SHA Verify is the
required runner timing proof, not an extrapolation from this VM.

After the fixture optimization, core passed in 482.0 seconds and authorizations
in 542.0 seconds locally (all four real CLI transfers: 137.8, 143.1, 133.5 and
126.4 seconds). The remaining work includes the public CLI's policy, migration
history, empty-target and archive validation, with no test or assertion removed.
In rebalance Verify 41718952920, the authorization job spent 31.0 seconds outside
its test process (639 seconds total versus 608.1 seconds of cases). Allowing
that observed setup/cleanup cost gives 573 seconds: 12 minutes permits only
540 seconds at 75%, while 13 permits 585. Thirteen is therefore the smallest
whole-minute limit covering the measured remaining cost and runner overhead.

The adopted Base workflow has exactly two local value changes: the reusable
`timeout` input default and the shard fallback become 13 rather than 12 in
`.github/workflows/verify.yml`. Keep both together through Base refreshes and
report this narrow override to gr. Explicit caller timeouts remain supported.
The seed-owned manifest and archive fixtures carry the rebalance and setup
optimization. Exact-SHA Verify must demonstrate every shard within 585 seconds
(75% of 13 minutes) and the longest within 1.5 times the eight-shard mean;
an expected generated-view failure does not exempt source from these timing
requirements.

Balm retains its `v*` tag trigger on Verify and its separate Release checks
workflow, which calls Verify with `tier: all`. Both retain complete release
coverage. Nightly journeys runs only on its Monday/Thursday schedule and manual
dispatch; it does not add another tag-triggered run. Scheduled calls use
`tier: nightly`, while manual Nightly journeys and Release checks use
`tier: all`. Verify's planner also requires `all` for `v*` tags.

The nightly cron is rendered with Base's seed-name renderer using `balm`.
The edition keeps Node 22.20.0 and pnpm 10.12.4. Its current custom shard
commands and undeclared product readers select full coverage for document-only
changes; the light job is available when the planner can prove a reviewed
selection. This adoption does not change the manifest to enable light coverage.

## Declare coverage

The verification manifest has `push` and `nightly` arrays. Each shard has a unique
`name`, boolean `browser` and `hosted` fields, and nonempty shell `commands`.
Exactly one push shard must be hosted. That shard retains RER's hosted-output
and hydration checks; every other shard uses the app verification path.

Inspect selections from a delivered checkout:

```sh
node scripts/verify-ci.mjs --matrix push
node scripts/verify-ci.mjs --matrix nightly
node scripts/verify-ci.mjs --matrix all
```

Run a named shard with `node scripts/verify-ci.mjs NAME`. Local `rer verify`
retains both arrays. Moving whole slow installer and README journey files to
nightly changes scheduling, not local or release coverage. Empty nightly arrays
produce an empty selection and skip matrix expansion safely.

## Push evidence and integration trees

The planner uses the current numeric workflow ID, workflow name, repository ID,
repository name and exact commit SHA. Only another eligible push of that SHA
can supply evidence. It selects the newest eligible push before inspecting its
latest attempt and jobs. A newer failed, cancelled or incomplete push defeats
an older green one. PRs, schedules and subset dispatches never supply push
proof, even when their aggregates are green.

A branch push produces `full-push-proof` only after full push coverage succeeds.
Light and reused runs do not produce it. Tags cannot produce it. Reuse requires
that proof, successful planning, every required push shard and the successful
aggregate from the latest attempt. A green aggregate with skipped tests alone
proves nothing. Skipped optional jobs are permitted; required jobs must succeed.

A same-repository PR waits for its head branch's producer for a bounded period
within the existing planning deadline. Missing or inaccessible evidence, lookup
errors, a failed or cancelled producer, or an expired wait selects full coverage.
Fork PRs run fully. The API run identity, PR head SHA and runner's tested merge
SHA are handled separately. Both commits must be identifiable and have equal
Git trees before head-push evidence can replace integration testing. A different
or ambiguous merge tree runs fully.

A child with one direct parent can reuse that parent's newest full push proof
only when their Git trees match. The planner never searches earlier ancestors.
Multiple parents, uncertain identities or incomplete comparisons run fully.
Every API listing must be complete and stable, with distinct valid entries;
partial pages, changing totals, authentication errors, redirects, rate limits,
invalid JSON and request timeouts select verification.

Base's existing `--main-skip` command and output remain available for its legacy
workflow while its CI packing is adopted separately. That compatibility path
retains its existing complete-job policy. The seed templates use `--plan` and
the explicit branch-only proof described here.

## Light coverage

Light selection requires a single direct parent with successful full push proof
and a complete local Git diff containing only these exact root documents or
paths beneath the two evidence directories:

```text
sources.lock.json
CONTRACT.md
ACCEPTANCE.md
CLAIMS.md
HANDOVER.md
STATUS.md
evidence/**
.artifacts/**
```

Both sides of renames count. Code changes, unverified parents, merge commits,
missing authoring prerequisites and uncertain diffs select full coverage.
Executable, configuration or unknown evidence formats also select full
coverage. The initial evidence formats are Markdown, text, PNG, JPEG and PDF.
This does not exempt files from source integrity or publication checks.

The explicit reader table in the light helper describes the maintained
reference and foundation tests and package commands. Unknown commands or test
readers select full coverage. Keep the table aligned with adopting tests; do
not infer arbitrary dependencies or exempt unknown readers. The maintained
runtime, auth, setup and installer tests have no direct semantic dependencies
on the permitted documents. Contract consistency is checked explicitly.

An edition declares additional reviewed readers in `verification.json`, beside
`push` and `nightly`:

```json
"readers": {
  "tests/product-contract.test.mjs": ["CONTRACT.md", "STATUS.md"]
}
```

Each key is a test path (or the exact test glob used in a shard command); its
value lists the repository-relative files that test reads semantically. An
empty array declares that it reads none of the permitted light inputs. A
declaration replaces the maintained entry for that same test, so editions that
adapt a maintained test must also review its dependencies. When a listed file
changes, light coverage runs that test through Node's test runner. Missing
tests, malformed declarations and undeclared tests still select full coverage.
The table does not expand the permitted light inputs or supported command forms.

Light coverage performs the edition source-lock validation, `rer check`, all
selected existing reader tests, generated contract-document consistency when a
contract document changed, and `rer build --site`. Source-lock validation is
mandatory: a candidate missing its edition manifest, lock or authoring helper
cannot select light. CI never updates the source lock. Intentional edits are
locked locally before pushing.

## Twice-weekly schedule and nightly markers

Generation hashes the seed name deterministically and maps it to one minute
between 02:00 and 07:59 UTC. It writes one static Monday and Thursday cron. Foundation
initialization and reference export use the same renderer. When selecting an
older pinned Base revision, initialization still takes that revision's workflow
bytes and helpers, then applies this schedule transformation. The final hash,
original source path and transformation are recorded in the foundation lock.
Reference provenance records the transformation too. This is a rendered copy,
not a claim that the original nightly bytes were copied unchanged.

The cache restore action uses lookup-only mode for `nightly-green-<full-sha>`;
it does not download a marker. Only main's scheduled or manual complete nightly
coverage can save it, after every selected shard succeeds. Branches and PRs
cannot produce trusted markers. Tags always run all coverage and bypass lookup.

An immutable marker is only a hint. Before skipping nightly work, the planner
requires the newest same-workflow scheduled or manual main run at that SHA to
have a successful latest attempt, complete nightly shards, `nightly-proof` and
aggregate. A newer failure defeats an old marker. Reused, empty or partial
nightly selections cannot manufacture a marker.

## Browser and cache setup

Prepare the runner-owned browser and apt archive directories under runner temp
before cache restore or sudo. Restore frozen dependency and browser caches,
install dependencies and prepare RER tools. Browser shards then:

1. Run `playwright install chromium` as the runner.
2. Launch Chromium and close it.
3. Only after launch failure, invoke the existing bounded system-dependencies
   helper and probe again.

Permission errors fail explicitly and do not trigger apt repair. Browser install
errors also fail immediately. The existing bounded apt helper, ownership
handling and EACCES refusal remain in place. Never repair the owner's HOME cache
silently or treat a permission failure as a successful skip. Nonbrowser shards
do not install Chromium. Native browser journeys retain bounded disk reclaim,
checking free space before each deletion and stopping at 20 GiB.

## Adoption checks

Deliver every imported verification helper alongside the entry point. Balm
receives `scripts/verify-ci.mjs`, `scripts/verify-plan.mjs`,
`scripts/verify-evidence.mjs`, `scripts/verify-light.mjs` and
`scripts/install-chromium-deps.py` from the same pinned Base revision. Mirror
regeneration belongs to the Base checkout; the seed retains its adapted
workflow and this adoption guide through its Base-copy records.

Run actionlint on workflows and run the helper's `--check-workflows` command.
Every caller must grant `contents: read` and `actions: read` to the job calling
Verify. A reusable workflow cannot increase its caller's token permissions;
actionlint alone does not catch that rejection. The helper tests retain both
checks and exercise planning through GitHub HTTP responses and real Git trees.

Adoption proof names the exact SHA, API head identity and tested merge ref
separately. A PR result remains a PR result. Preserve product journeys and
edition-owned source-lock checks when merging the template.
