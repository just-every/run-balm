// Clinic records, the access audit, import originals and their journals travel
// together. Credentials do not: agent keys, patients' pay links (the desk sends new
// ones) and the sealed Stripe connection (a restored install connects its key again), the scribe's sealed model key, and the backup storage
// record with its sealed credentials and run history (a restored clinic sets its own backups up again). Settings and the default intake form are
// migration-seeded rows, which a restore replaces.
export default {
  product: 'clinic/balm',
  includeTables: ['rer_mail_event_receipts', 'rer_mail_event_states', 'oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  secretColumns: {bm_booking_payments:['checkout_url']},
  excludeTables: ['bm_retail_staff_grants','bm_booking_payment_tokens','bm_accounting_connection','bm_portal_sms_codes','bm_guardian_links','bm_guardian_sessions','bm_integration_hooks','bm_schedule_revision','bm_staff_factors','bm_staff_factor_pending','bm_staff_recovery','bm_staff_session_proofs','bm_staff_factor_attempts','bm_mail_reply_links', 'bm_calendar_feeds', 'bm_agent_keys', 'bm_pay_links', 'bm_stripe', 'bm_scribe', 'bm_backup_settings', 'bm_backup_runs', 'bm_message_links', 'bm_visit_reply_links', 'bm_portal_links', 'bm_portal_sessions', 'bm_portal_rates', 'bm_consent_links'],
  replaceableTables: ['bm_staff_security_policy','bm_settings', 'bm_intake_forms', 'bm_consent_policies', 'bm_medicare_settings', 'bm_documentation_settings'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}
