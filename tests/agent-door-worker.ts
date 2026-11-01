// Exercise the production agent middleware ahead of the existing HTTP harness.
import original from './worker.ts'
import {agentResponse} from '../src/balm/agent-door/index.ts'
import type {Bindings} from '../src/auth.server.ts'
export default {...original,async fetch(request:Request,env:Bindings) {
  return await agentResponse(request,env)??await original.fetch(request,env)
}}
