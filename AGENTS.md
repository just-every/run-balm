# Agent instructions

## Launch for review

When asked to launch, run or review this app, run this from the checkout root
and nothing else:

```sh
rer dev
```

- It installs and sets up a fresh checkout by itself and prints progress; a
  first launch can take several minutes. Give the shell tool at least 10
  minutes. If the tool times out, run the same `rer dev` again: it resumes.
- Never run install, setup, reset or deploy for this, and never ask for an
  email, port, password or answers file.
- Give the owner the `RER_READY` address and the `RER_OPEN` link, and ask
  nothing. `RER_OPEN` is a credential: share it only with the owner, in this
  chat.
- Stop the app with `rer dev --stop`. If a start is refused, the message names
  the cause and the next command: run that command.

Without `rer` on PATH, install it once with the installer script, which brings its own Node when there is none:
`curl -fsSL https://runeditrun.com/install.sh | sh`. With Node 22 or later already installed, `npx -y @runeditrun/rer cli install` does the same.
For the current shell, run `export PATH="$HOME/.local/bin:$PATH"` after installing.

## Run it locally

To install for a real owner instead of a review launch, run the verbs yourself
from the checkout root. `rer` runs each verb with the exact `@runeditrun/rer`
pinned in `package.json` (package mode).

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Commands that run project work select the exact Node version declared by the
project. They use an exact matching installed runtime or a checksum-verified
copy cached at `~/.rer/node/node-vVERSION-PLATFORM-ARCH/`; when needed on
supported platforms, the runner retrieves the official Node release and checks
its SHA-256 against `SHASUMS256.txt`. It does not change global Node installations.
Set `RER_NODE_AUTO=0` to disable automatic selection. If selection is disabled
or acquisition fails, the command reports a repair invocation in this form:
`npm exec --yes --package=node@VERSION -- node SCRIPT VERB --cwd PROJECT`.
Help, check, describe, doctor and stop do not select or acquire Node.

After `RER_READY`, `dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`.
Open that URL on this computer: the app opens signed in as the owner and
finishes first-run setup at `/setup`. Treat the line as a credential.
`dev --as PERSONA` starts as a persona or signed out. Legacy `dev --login`
uses the same automatic sign-in. Until first-run completion is stored durably, app routes send the signed-in owner to `/setup`;
signed-out visitors sign in and return there. Once complete, `/setup` opens the
app or settings. Development and demo mail is silently suppressed.

The saved local port is used; a first setup saves the first free port from 8787. Explicit ports are decimal
integers from 1 through 65535 and must be free; a busy requested port fails
instead of silently moving. Only `127.0.0.1`, `localhost` and `::1` are allowed.
Dev applies the selected host and port to both the listener and runtime bindings;
readiness is bounded and failure stops the owned processes.

Missing non-interactive setup answers exit 3 and name the manifest fields.
Read `rer-setup.json` and pass a private, mode-0600 JSON object keyed by those
names using `rer setup --answers PATH --non-interactive`,
for example `{"OWNER_EMAIL":"owner@example.com"}`. Secret values stay in
private inputs and never go in command arguments. A setup rerun with the saved
owner and origin preserves existing owner/data and exact private settings.
Conflicting saved identity or origin reports an actionable recovery path.
Review reset's exact removal inventory before confirmation; export domain data
first if it should be restored, and import only into an empty destination.

Queue waits report their reason and live position while the command waits. Package mode has no queue status command.

Use the setup prompt instead of `--owner-email` when entering the real owner
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner, including with legacy `dev --login`. No external
email is sent in development or demo mode. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

Reset removes declared local data and settings. Import requires an empty
destination and explicit confirmation. Read `RUN-LOCALLY.md` for supported
flags, private state, deployment inputs and remote limitations.

`pnpm typecheck` and `rer verify` use checkout-local, gitignored
`.cache/typecheck.tsbuildinfo`; deleting it forces a full check, while
`rer build` builds the real Worker and assets.

## Work on Balm

Lander-Regenerate for the native outcome reporting slice:
`node scripts/contract-docs.mjs write REPORT-003`, then
`node scripts/contract-docs.mjs check REPORT-003`. CONTRACT.md supplies acceptance,
status, evidence and remaining work; the command refreshes the projections and counts.

Read README.md, ACCEPTANCE.md and CONTRACT.md first. Product HTTP doors are in
`src/balm/http.ts`; domain commands in `src/balm/domain` (one module per job);
server-rendered screens on Base's theme in `src/balm/ui`; the availability
engine copied from Dial in `src/balm/availability`; the Cliniko move-in adapter
in `src/balm/movein`. D1 migrations are append-only in `migrations/core`.

Every handler resolves the live actor and enforces its role itself, and every
write re-checks authority in the same D1 batch (`commit` in
`src/balm/domain/model.ts`). Agent keys only prepare; a native human session
approves. Treatment notes and intake answers never appear in agent context or
reception views, and every clinical read writes an audit row. Keep
`bm_audit` append-only and free of client personal details.

Run `pnpm run test:balm` and `pnpm run test:archive` for changed flows,
`pnpm run typecheck` for source and `rer verify` for the full local plan. Tests
stay under the cap in `test-budget.json`; no mock application data or
fallbacks. Keep deploy, project, edition, Worker, D1 and package identities
stable. Run Base's publication scan on the exact tree before a public push.

`setup` builds, applies declared migrations, prepares the explicit first
owner and stops its temporary Worker. `dev`
serves actual Vite HMR with the same auth and data. Managed foreground servers
remain active in their first invocation; compatible repeated invocations reuse
the server and exit. Stop before build or verification.

`deploy --dry-run` validates and builds locally without provider requests. Real
owner-account deploy applies declared D1 migrations and checks health. Local
validation does not establish provider acceptance or remote health.

Read `ONBOARDING.md` before changing the edition-owned answer manifest, branding
or installer adapter. Keep `rer-setup.json` as the single setup manifest and
preserve the shared RER command path. The owner may change any source, core
schema, UI, framework or infrastructure. Preserve owner requirements and
applied migration history; choose any integration method and verify the result.
Roll useful implementations and tests into shared source where that supports
their maintenance.

Pinned reference: https://github.com/runeditrun/base/blob/ada9f574d8a7247edc3a1180b593ad182b1fbb37/TANSTACK-START-MIGRATION.md
Native-session/runtime evidence: https://github.com/runeditrun/base/tree/ada9f574d8a7247edc3a1180b593ad182b1fbb37/default-seed

## Contract documentation regeneration

Lander-Regenerate: `node scripts/contract-docs.mjs write REPORT-003 CHART-011`, then
`node scripts/contract-docs.mjs check REPORT-003 CHART-011`. Both adopted projections
are maintained together, including when an older invocation names only REPORT-003.
CONTRACT.md supplies acceptance, status,
evidence and gaps. The generator incrementally adopts marked clauses while
preserving legacy acceptance narratives and homepage claim rows. Regenerate
`sources.lock.json` last with `node scripts/edition-authoring/cli.mjs lock`.

## Lander-Regenerate

COMM-003 evidence and Gap registers are generated from CONTRACT.md without changing acceptance text or homepage copy. Run `node scripts/contract-docs.mjs write COMM-003`, then `node scripts/contract-docs.mjs check`. Regenerate the edition source lock last with `node scripts/edition-authoring/cli.mjs lock`, then run its `check`.

MOVE-006 historical invoice carry uses the same Lander-Regenerate command:
`node scripts/contract-docs.mjs write MOVE-006`, then
`node scripts/contract-docs.mjs check MOVE-006`. Regenerate the source lock last
with `node scripts/edition-authoring/cli.mjs lock`, then its `check`.

SCHED-005 preference evidence uses Lander-Regenerate:
`node scripts/contract-docs.mjs write SCHED-005`, then
`node scripts/contract-docs.mjs check SCHED-005`. The default check retains this adopted projection.
COMM-002 scheduled SMS quiet hours uses Lander-Regenerate:
`node scripts/contract-docs.mjs write COMM-002`, then
`node scripts/contract-docs.mjs check COMM-002`. Keep the source lock last:
`node scripts/edition-authoring/cli.mjs lock`, then its `check`.
HIPAA-005 uses the same Lander-Regenerate entry point:
`node scripts/contract-docs.mjs write HIPAA-005`, then
`node scripts/contract-docs.mjs check HIPAA-005`. Hosting evidence is historical
in archives; patient mode and deployment qualification are excluded. Regenerate
the source lock last with `node scripts/edition-authoring/cli.mjs lock`, then its
`check`.

INS-011 institutional preparation uses Lander-Regenerate:
`node scripts/contract-docs.mjs write INS-011`, then
`node scripts/contract-docs.mjs check INS-011`. Regenerate the edition source lock
last with `node scripts/edition-authoring/cli.mjs lock`, then its `check`.
