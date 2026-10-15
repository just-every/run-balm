// Clinic records, the access audit, import originals and their journals travel
// together. Agent credentials do not. Settings and the default intake form are
// migration-seeded rows, which a restore replaces.
export default {
  product: 'clinic/balm',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  excludeTables: ['bm_agent_keys'],
  replaceableTables: ['bm_settings', 'bm_intake_forms'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}
