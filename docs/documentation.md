# Documentation compliance

Clinic owners set the plan certification deadline (30 days by default), how close to the annual KX threshold to warn, and each payer’s required note elements under **Clinic → Documentation requirements**. Requirements apply to active policies covering the visit’s clinic-local date.

Every unsigned note shows warnings before its review-and-sign form:

- Medicare progress reports due by the tenth distinct treatment day in the reporting period, including the initial evaluation day; the next treatment day after a signed progress report begins a new period.
- Missing, uncertified, late or expired plans of care.
- Recognized/estimated Medicare spending approaching or reaching the service year’s KX threshold, including the note’s current CPT estimate.
- Assistant involvement and the named active practitioner supervisor.
- Missing payer-required treatment minutes or note sections.

The **Daily close: documentation** list on the schedule carries the same visit warnings and missing/unsigned notes. Only clinic owners and treating practitioners can read it; reading it is audited. Warnings ask the clinician to review the record. Payer-required missing elements block signing with the payer and element named.

Treatment minutes and supervision facts belong to each immutable note revision. The signed digest covers those facts along with its text, sections and CPT minutes. Correct the draft before signing; later changes use signed addenda. Recorded total timed minutes cannot be less than the timed CPT minutes, and total treatment minutes cannot be less than total timed minutes.

`tests/charting.test.mjs` exercises historical attendance imported through the reviewed CSV move-in flow, plan/KX/supervision warnings, the daily close and a refused then completed signature. Medicare annual amounts, recognized expenses and claim modifiers are described in [insurance.md](insurance.md).

Progress-period counting follows the [CMS Medicare Benefit Policy Manual, chapter 15](https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/Downloads/bp102c15.pdf), section 220.3.
