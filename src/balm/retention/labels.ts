/** Patient-facing inventory groups; counts cover stored records, revisions and attachments. */
const groups: Record<string,string[]> = {
  'Patient identity and imported identity history':['clients','import_client_revisions'],
  'Visits, recurring bookings and waitlist offers':['series','appointments','waitlist','offers','offer_recipients','visit_cancellations'],
  'Treatment notes, measures and signatures':['notes','assistant_signed_notes','assistant_supervision','note_releases','note_release_approvals','note_release_revocations','note_submissions','note_reviews','note_revisions','note_addenda','measures','movein_notes'],
  'Care plans and home exercises':['plans_of_care','home_exercises','home_exercise_done'],
  'Intake answers, consent and uploaded images':['intake_responses','intake_consents','intake_photos','intake_identity','intake_insurance','consent_declines','consent_links'],
  'Chart documents and clinical alerts':['chart_documents','client_alerts'],
  'Messages, attachments and private conversation links':['messages','message_attachments','message_links'],
  'Invoices, payments, fees and billing codes':['invoices','payments','card_payments','visit_codes','visit_fees','movein_balances','account_entries','account_postings','patient_statements','aeob_sources','aeob_issues','estimate_requests','estimate_drafts','estimates','estimate_deliveries'],
  'Saved payment credentials and private payment links':['card_setups','cards','stripe_customers','pay_links'],
  'Payment plans and balance reminders':['payment_plans','plan_installments','balance_reminders','balance_notices','balance_review_queue'],
  'Insurance coverage, claims and remittance detail':['policies','authorizations','eligibility','claims','claim_batch_items','claim_events','insurance_adjustments','remittance_claims','payer_payment_lines','cob_stages','cob_adjudications','cob_patient_decisions','cob_paper_packets','cob_manual_reductions','movein_insurance','medicare_abns','medicare_expenses','medicare_years'],
  'Referrals and referral work':['referrals','case_drafts','case_steps'],
  'Integration booking events and delivery history':['integration_events','integration_deliveries'],
  'Guardian authority and submitted profile changes':['guardian_grants','guardian_sessions','portal_profile_changes'],
  'Portal access, record requests and released copies':['portal_links','portal_sessions','portal_sms_codes','record_requests','record_packages','record_parts'],
  'Reminders, follow-ups and delivery history':['mail_attempts','mail_attempt_visits','mail_reply_links','visit_reminders','visit_reply_links','followups','followup_attempts'],
  'Care-team access, emergency access and disclosures':['care_grants','break_glass','disclosures'],
  'Assistant drafts':['drafts'],
}
export function destructionGroups(records:Record<string,number>) {
  return Object.entries(groups).map(([label,tables])=>({label,count:tables.reduce((sum,table)=>sum+(records['bm_'+table]??0),0)})).filter(g=>g.count>0)
}
