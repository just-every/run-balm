// Clinic records, the access audit, import originals and their journals travel
// together. Credentials do not: agent keys, patients' pay links (the desk sends new
// ones) and the sealed Stripe connection (a restored install connects its key again), and the scribe's sealed model key. Settings and the default intake form are
// migration-seeded rows, which a restore replaces.
export default {
  product: 'clinic/balm',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  excludeTables: ['bm_agent_keys', 'bm_pay_links', 'bm_stripe', 'bm_scribe', 'bm_message_links', 'bm_visit_reply_links', 'bm_portal_links', 'bm_portal_sessions', 'bm_portal_rates'],
  replaceableTables: ['bm_settings', 'bm_intake_forms'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}
