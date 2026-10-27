// The agent door described for assistants that import an OpenAPI schema (a
// ChatGPT custom GPT's Actions, for example). It names only the two agent
// routes; the key travels as a Bearer token the assistant's owner pastes in.
export function agentOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Balm clinic assistant',
      version: '1',
      description: 'Read the clinic\'s schedule, clients\' names and contact details, services and invoices (never treatment notes or intake answers), and prepare invoices, reminder texts and intake form versions. A person at the clinic approves every preparation in Balm; nothing is sent or changed until they do.',
    },
    servers: [{ url: origin }],
    components: { securitySchemes: { agentKey: { type: 'http', scheme: 'bearer', description: 'The agent key from Balm → Agent access.' } } },
    security: [{ agentKey: [] }],
    paths: {
      '/api/balm/agent/context': {
        get: {
          operationId: 'readClinic',
          summary: 'Read the clinic\'s working state: settings, staff, services, hours, upcoming and recent appointments with client names, invoices and drafts awaiting approval.',
          responses: { 200: { description: 'The clinic\'s working state.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } },
        },
      },
      '/api/balm/agent/command': {
        post: {
          operationId: 'prepare',
          summary: 'Prepare one piece of work for a person to approve: invoice.prepare (an attended visit\'s invoice), reminder.prepare (an upcoming visit\'s reminder text) or intake.prepare (a new intake form version).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object', required: ['name', 'input'], additionalProperties: false,
              properties: {
                name: { type: 'string', enum: ['invoice.prepare', 'reminder.prepare', 'intake.prepare', 'finance.reconcile.prepare', 'movein.prepare'] },
                input: {
                  type: 'object', additionalProperties: false,
                  description: 'invoice.prepare and reminder.prepare take appointmentId (from readClinic). invoice.prepare may also take amountCents (whole cents, for example 9500 for $95.00; leave it out for the service price). intake.prepare takes title and questions.',
                  properties: {
                    provider: { type: 'string', enum: ['webpt','jane','simplepractice','cliniko'], description: 'For movein.prepare, with the explicit migration.prepare scope.' },
                    practitionerId: { type: 'string' },
                    serviceId: { type: 'string' },
                    expectedTotals: { type: 'object', description: 'Owner-supplied source control totals for reconciliation.' },
                    dateFormat: { type: 'string', enum: ['MDY','DMY','YMD'] },
                    files: { type: 'array', items: { type: 'object', required: ['kind','name','csv'], properties: { kind: { type: 'string', enum: ['patients','appointments','balances','insurance','invoices','authorizations','claims'] }, name: { type: 'string' }, csv: { type: 'string' } } }, description: 'Owner-supplied export files. Clinical note files are refused at the agent door; returned metadata excludes field examples and patient records.' },
                    month: { type: 'string', description: 'YYYY-MM for finance.reconcile.prepare; requires its explicit finance scope. Only prepares cited review items, with no outbound request or refund.' },
                    appointmentId: { type: 'string' },
                    amountCents: { type: 'integer', minimum: 0 },
                    title: { type: 'string' },
                    questions: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', required: ['id', 'label', 'type', 'required'], additionalProperties: false, properties: {
                      id: { type: 'string', description: 'lowercase letters, digits and underscores, starting with a letter' }, label: { type: 'string' },
                      type: { type: 'string', enum: ['short', 'long', 'yes', 'date'] }, required: { type: 'boolean' } } } },
                  },
                },
              },
            } } },
          },
          responses: {
            200: { description: 'The preparation, waiting for a person to approve it in Balm.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
            400: { description: 'The input was not valid; the error says why.' }, 403: { description: 'Agent keys can only prepare.' }, 409: { description: 'The visit or form changed, or is not ready for this.' },
          },
        },
      },
    },
  }
}
