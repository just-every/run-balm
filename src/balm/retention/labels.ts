/** Patient-facing inventory groups; counts cover stored records, revisions and attachments. */
const groups: Record<string,string[]> = {
  'Patient identity and imported identity history':['clients','import_client_revisions'],
  'Visits, recurring bookings and waitlist offers':['series','appointments','waitlist','offers','offer_recipients','visit_cancellations'],
  'Treatment notes, measures and signatures':['notes','note_revisions','note_addenda','measures','movein_notes'],
  'Care plans and home exercises':['plans_of_care','home_exercises','home_exercise_done'],
  'Intake answers, consent and uploaded images':['intake_responses','intake_consents','intake_photos','intake_identity','intake_insurance','consent_declines','consent_links'],
  'Chart documents and clinical alerts':['chart_documents','client_alerts'],
  'Messages, attachments and private conversation links':['messages','message_attachments','message_links'],
  'Invoices, payments, fees and billing codes':['invoices','payments','card_payments','visit_codes','visit_fees','movein_balances'],
  'Saved payment credentials and private payment links':['card_setups','cards','stripe_customers','pay_links'],
  'Payment plans and balance reminders':['payment_plans','plan_installments','balance_reminders','balance_notices','balance_review_queue'],
  'Insurance coverage, claims and remittance detail':['policies','authorizations','eligibility','claims','claim_batch_items','claim_events','insurance_adjustments','remittance_claims','movein_insurance','medicare_abns','medicare_expenses','medicare_years'],
  'Referrals and referral work':['referrals','case_drafts','case_steps'],
  'Portal access and sessions':['portal_links','portal_sessions'],
  'Reminders, follow-ups and delivery history':['mail_attempts','mail_attempt_visits','mail_reply_links','visit_reminders','visit_reply_links','followups','followup_attempts'],
  'Care-team access, emergency access and disclosures':['care_grants','break_glass','disclosures'],
  'Assistant drafts':['drafts'],
}
export function destructionGroups(records:Record<string,number>) {
  return Object.entries(groups).map(([label,tables])=>({label,count:tables.reduce((sum,table)=>sum+(records['bm_'+table]??0),0)})).filter(g=>g.count>0)
}
