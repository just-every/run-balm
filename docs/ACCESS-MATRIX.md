# Staff access

The owner assigns and revokes each job in **Clinic → Staff**. Job changes and deactivation take effect on the next request, including an existing session. A command checks the staff version again in its write transaction. Refusals are audited without submitted clinical text.

| Job | Reads | Writes |
| --- | --- | --- |
| Owner | All clinic records; every clinical read audited | Existing owner administration and approvals |
| Practitioner | Their calendar, treating-patient files, their own notes; care-team grants and recorded emergency access as before | Their calendar, clinical records and their own signatures |
| Reception | Clinic calendar, administrative files and billing; no note text, clinical intake or chart search | Existing reception work; no owner administration or clinical signatures |
| Biller | Administrative patient files, invoices, signed charge facts, claims and financial reports/CSVs; no note text, intake answers, chart document metadata, operational reports or owner settings | Invoices and recorded payments; exact-digest adjustment/credit/refund preparation and approval; patient payment links/plans/reminders; coverage, authorization, eligibility, claim, batch, acknowledgment, remittance and recognized-expense billing commands. No clinical attestations, calendar writes, patient identity changes or configuration |
| PTA/COTA/SLPA assistant, student, clinical fellow | Their own calendar and treating-patient files, with existing clinical read audits | Own note drafts, revisions and objective measures; author signature submitted to a named licensed supervisor. An explicit documentation review uses the already configured clinic model and includes the supervision rule. No independent final signature, clinical addendum, billing, emergency opening, calendar write or administration |
| Supervisor | Practitioner access plus the exact notes submitted to them and their review history. Submission alone grants no other patient-file access | Own practitioner work; co-sign or return their named submissions. No editing another author's revision |
| Location manager | Read-only schedule and visit-count reports for the one assigned location; each named patient audited | None; every command except sign-out is refused |

New commands default to refusal for billers, supervised staff and location managers until explicitly included. Agent keys keep their existing preparation-only permissions and never become staff.

**Locations** group treatment rooms. The owner assigns a room before it is used; a room with visits cannot be moved to another location because that would change historical scope. Visits with an unassigned room or no room are excluded from a location manager's view. Location managers cannot follow a patient link or obtain an unscoped clinic state.

**Supervision** records an immutable author signature on the exact note revision. The revision and measures freeze while awaiting review. A named, active licensed supervisor can return it with a reason; that history remains and the author saves a new revision before submitting again. Co-signing locks the note with both signatures and a digest binding them. Existing care-team and emergency readers retain audited access. Each payer's owner-recorded rendering rule defaults to billing co-signed visits under the supervisor; confirm that rule in **Clinic → Supervised visit billing**. A visit with conflicting rendering supervisors is refused rather than guessed.

These are conservative adopted defaults pending contract-lane approval of ROLE-002 and CHART-008. No permission to change an owner's existing requirement is implied.
