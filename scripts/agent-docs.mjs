import {readFileSync,writeFileSync} from 'node:fs'
const surface=JSON.parse(readFileSync('agent-surface.json','utf8'))
const rows=surface.tools.map(tool=>`| \`${tool.name}\` | ${tool.classes.join(', ')} | \`${tool.scope}\` | ${tool.clauses.join(', ')} | ${surface.journey.filter(step=>step.tool===tool.name).map(step=>'\`'+step.id+'\`').join(', ')} |`)
const result=`<!-- Generated from agent-surface.json; checked against the live registry by rer verify. -->
## Therapy practice coordinator

This declared core slice supports clinic identity, service fees and duration, rooms and equipment, native staff jobs, intake preparation and publication, and configuration reads. The registry at /mcp is the runtime authority. It accepts MCP 2026-07-28 and 2025-11-25. Company policy governs each registered call; the sponsor's current native clinic role governs its service access. Most configuration jobs require the native owner role; the template catalogue retains native active-staff admission. Business admin status does not grant a clinic job.

| Tool | Possible classes | Scope | Clauses | Conformance steps |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## Records, identity and approvals

The public resource registry is empty in this CORE declaration. Six internal configuration readers (\`balm://clinic/{id}\`, \`balm://service/{id}\`, \`balm://staff/{id}\`, \`balm://room/{id}\`, \`balm://equipment/{id}\`, \`balm://form/{id}\`) retain native owner visibility for future adoption; they expose no public templates, reads or result links. Stored labels, questions and imported text are untrusted. No bearer or provider credential is returned. The witness masks an SSN; clinic identity reads classify an actual full SSN as sensitive. Setting a service fee adds money; changing only duration retains live. Staff changes compute the native subject and refuse self-widening.

Business owner_id and team id bind to native operator ids. Existing team people keep their clinic grants; a signed roster does not create shadow accounts. Unknown, inactive or natively inadmissible subjects cannot act. Original local preparation keys retain their original scopes and revocation checks. A failed recognizable Business token cannot become a local key. Native sessions and independent second-factor proof control the person-only /agents and approval pages. The agent prepares; actual reviewers are named separately in native activity. Autonomous policy invents no human approval.

## Boundaries

The declared capability set is tools, policy, pause, audit and idempotency. The runtime is copied from Base \`114ef7a61f080da053af783c5fbe06f625d692cc\`, with released \`rer 0.2.88\`. Events, resources, prompts and subscriptions are undeclared: discovery omits them, listings are empty and calls return \`capability_not_declared\` with the family name. An unknown native tool returns \`tool_not_found\`. Multi-sponsor, mail edges, resource refresh, timed lifecycle, dual host, queued lifecycle and owner-native API verification remain unscoped and unproved; the subset makes no claim about them. There is no provider spend registration or spend enforcement, and these tools contact no outbound provider.

An approved clinic update that removes an SSN exposes a shared Base retry edge: the native effect completes, but the retry reclassifies as review and loses its approval receipt. This prevents full conformance; inspect the current clinic state before preparing another update. The review audit row is also missing for that refused retry.

Pinned Base also has no client-scoped retained-artifact redaction and atomic pending-execution/capture hook for Balm erasure. Native custody remains closed rather than claiming that patient deletion clears retained approvals or replay outcomes.

Patient/chart, appointment, ledger, payer, messaging, finance, backup and destruction adapters from ct's draft are not claimed by this configuration slice. Existing native clinical signatures, patient consent, independent proof, imports, devices, connectors, provider callbacks and installation operations keep their own doors. The legacy scoped preparation API retains its existing behavior; its complete policy migration is still owed. No target-only clinical or provider capability is registered.

The disposable journey uses the seed's real setup-token bootstrap, native authenticator enrollment and first-run confirmation. It exercises all declared tool/class pairs under autonomous and held policies, injection arguments, replay, pause and staff self-escalation. Browser proof uses the actual native pages at 1440 and 390. A failing or undeclared check is not acceptance.

Capacities are 600 requests per minute and 1 MiB per MCP request, not company volume policy. Native questions are bounded to 40, service durations and prices use native validation. Errors use named JSON codes and MCP \`com.runeditrun/error\` metadata; approvals bind exact summary hashes and native revisions. Undo is omitted because these jobs have no native reviewer reversal.
`
const file='docs/agents.md'
if(process.argv[2]==='check'){if(readFileSync(file,'utf8')!==result)throw Error(file+' is stale')}else writeFileSync(file,result)
console.log('agent-docs '+(process.argv[2]??'write')+' passed')
