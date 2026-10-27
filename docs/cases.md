The case agent follows each referral from authorization to paid claim. Open **Cases** (owner, reception and billing staff) to see every case in one list, where each one stands, and the next step Balm has lined up for a person to approve.

## Open a case

A case starts from a referral. In **Cases**, open **New referral** and choose the patient, the insurance policy the case bills (or self-pay), the date the referral arrived, the referring provider and their NPI, the diagnosis and what was ordered. Add the address this payer takes authorization requests at: Balm sends a request there only after a person approves it.

The case covers the patient’s visits from the referral date until their next referral.

## Where each case stands

Each case shows nine stages, each worked out from the clinic’s own records and linked to the record it rests on:

- **Referral**: who referred the patient and when.
- **Intake**: whether the patient’s intake form has come back.
- **Eligibility**: the latest 271 response; stale after 30 days, stalled when coverage is inactive or changed.
- **Authorization**: visits used, booked and left on the current authorization, and when it ends; waiting at 2 visits left or 14 days to expiry, stalled when none are left or it has expired.
- **Visits**: attended visits and the next one booked.
- **Notes signed**: stalled while an attended visit has no signed note.
- **Claim sent**, **ERA posted** and **Paid or denied**: claims made from signed visits, remittances posted, denials with their payer codes, and the patient’s balance.

A stage that waits on the clinic says what moves it and links to where: record an eligibility check made by phone or upload the payer’s 271, fix each reason a held claim names, download a claim file for upload, or upload the payer’s 835.

## What moves a case to paid or denied

A claim leaves Balm as an 837P claim file you upload to your clearinghouse or the payer’s portal (or through the clearinghouse connection, when one is set up). The payer answers with an 835, which the clearinghouse or the portal gives you. Upload it at the bottom of **Cases** or on the **Insurance** page: posting it marks each claim paid or denied, records the patient’s share and moves the case to **Paid or denied**. A 277CA only says the claim was received or rejected. Without a clearinghouse, check eligibility by phone or the payer’s website and record it in the patient file; see [Insurance billing](/docs/insurance).

The top line of each case is the first stage that stalled, or else the furthest stage still waiting. A case reads **Reconciled** once every claim is paid and the patient owes nothing.

## Next steps, approved by a person

The agent lines up these steps when the records call for them, each with the records it used:

- **Re-verify eligibility** when coverage was never checked, is older than 30 days, or the last response was not active. Approving prepares the 270 inquiry for the next visit (and sends it through the clearinghouse adapter when one is set up).
- **Request more authorized visits** when 2 or fewer are left, the authorization ends within 14 days, or a claim was denied for a missing authorization (CARC 197). Approving emails the request to the case’s authorization contact with the latest signed note attached as a PDF, a progress report first. Because it carries a signed note, only the owner approves this request or drafts its wording.
- **Send the claim** for an attended visit with a signed note and an approved invoice. Approving prepares and scrubs the claim and puts it in its own 837P batch (sent through the adapter when one is set up).
- **Fix and resubmit a denial**, with the payer’s reason and what to do. A missing-authorization denial waits until the payer’s authorization is recorded. Approving prepares the corrected claim and batches it.
- **Send a patient statement** once the payer has paid and the patient owes a balance, at most every 14 days. Approving emails the patient a private link to their statement.

Nothing is sent until a person at the desk ticks **I reviewed this step and the records it cites** and approves. Balm keeps every approval with who approved it, when, the records cited and the exact wording sent. If the records change after the page was opened, the approval is refused and the step is shown again. An agent key cannot approve.

## Wording with your AI key

The rules above are plain code: the agent lists cases and next steps with no AI key. The owner’s AI key from **Clinic → Scribe** is used only to word the request paragraph of an authorization letter, from the case’s facts and signed note without the patient’s name, birth date or member ID. Without a key the page says so and Balm uses its standard paragraph. Every paragraph can be edited before it is approved. On RER Managed hosting, which has no outbound connection to AI providers yet, drafted wording is not available.


## Denial appeals

A 277CA rejection is shown with its original status and entity codes and a plain explanation, never as payment or an adjudicated denial. Each denied claim offers a corrected claim and an appeal. A missing-authorization correction still requires the newly recorded authorization that covers the visit and practitioner.

For an appeal, choose **Prepare appeal evidence**. Balm prepares the signed visit note through the existing payer note release. The owner opens the exact PDF and approves its digest for seven days. Billing staff download that approved evidence, review the letter citing the claim, payer reason, signed note and available authorization, then choose **Approve appeal packet**. Reception, clinicians and agent keys cannot approve this billing step. A changed digest, expired or revoked release refuses approval. The saved letter, evidence digest and biller identity stay with the case.

Approval prepares the packet for submission outside Balm and sends nothing. Download the approved evidence and use the saved letter in the practice's payer portal. The case continues to show **awaiting payment**. Only posting a paid remittance resolves it; neither a 277CA nor an appeal approval does. A later payment on a zero-payment denial retains both original adjudications and posts the payment once. Clearinghouse transport and enrollment remain INS-006 work.
