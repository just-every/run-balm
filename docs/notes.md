A practitioner documents each visit in its client's file, under **Treatment notes**. Notes start from physical therapy, occupational therapy and speech-language templates, are drafts until the practitioner signs them, and lock when signed.

## Templates

Each discipline has four templates: **initial evaluation**, **daily note**, **progress report** and **discharge summary**. Every template has **Subjective**, **Objective measures**, **Assessment**, **Goals** and **Plan** sections, with prompts for what a US therapist records in each, for example ROM and MMT grades for PT, ADL assist levels for OT, and standardized test scores for speech. Evaluations add **Diagnoses (ICD-10)**, progress reports add the **Reporting period**, and discharge summaries add the **Reason for discharge**.

The owner sets the template each service starts from on the **Clinic** page, under the service's **Notes for this service start from**. For example, set an initial evaluation service to **PT initial evaluation** and a follow-up to **PT daily note**.

## Write a note

1. Open **Write a note**, choose the visit and select **Start a note**. The note uses the template set on the visit's service. You can choose another template, or a free-text note, then select **Use this template**.
2. Write each section. **Goals** are filled from your latest signed note for this client, so you only update them.
3. Under **CPT codes and minutes**, pick each code you provided and its minutes.
4. Select **Save draft**. You can save the draft as often as you need; every save is kept as a revision.

## Billed units: the 8-minute rule

Balm counts billed units the way CMS does. Timed codes (for example 97110 therapeutic exercise or 97140 manual therapy) bill on their total minutes: 8 to 22 minutes is 1 unit, 23 to 37 is 2, 38 to 52 is 3, and so on. Each code first gets its whole 15-minute units; any unit left goes to the code with the most minutes left over. For example, 33 minutes of 97110 and 7 minutes of 97140 make 40 timed minutes: 3 units, 2 of 97110 and 1 of 97140. Untimed codes, such as an evaluation (97161 to 97168) or speech treatment (92507), bill 1 unit each.

The note shows each code's units and a line such as **8-minute rule · 40 timed min · 3 units**. Once the note is signed, these units go on the visit's invoice.

## Draft with the scribe

When the clinic has added its own AI model key (see [Set up your clinic](/docs/set-up-your-clinic)), **Draft with the scribe** appears when you write a note. Write your dictation or bullet points for the visit, for example `Ther ex 23 min: SLR 3x10. Manual 10 min patellar mobs. Pain 3/10 after stairs.`, and select **Draft the note**.

The scribe fills the template's sections and the CPT minutes from what you wrote, and leaves a section empty when you said nothing for it. It sends only your dictation and the template to the clinic's model, never the client's name or date of birth. The draft is marked **Drafted by the scribe**. Review and correct it, then sign it yourself: the scribe never signs.

Without a key, the scribe says **Add a key to use the scribe.** and drafts nothing. On RER Managed hosting, it says the scribe is not available yet, because Managed hosting cannot reach AI providers. It works on a self-hosted install.

## Review and sign

Open **Review and sign**, type your full name as it appears on your staff record, check your **Credentials** (for example `PT, DPT`, `OTR/L` or `CCC-SLP`), confirm that you reviewed the note, and select **Sign note**. Balm refuses to sign a template note with an empty required section.

The note shows **Electronically signed by** your name, credentials and the time. A signed note is locked: Balm, and the database underneath it, refuse any change.

## Addenda

To add something after signing, open **Add an addendum** on the signed note, write it and select **Sign and add addendum**. The signed note stays as it was. The addendum shows under it, signed with your name and the time.

## Unsigned notes on the schedule

The **Schedule** lists **Notes to sign**: every attended visit whose note is missing or not signed yet. Practitioners see their own visits, and the owner and reception see all of them. Each day shows a line such as **All 14 notes signed**, or **12 of 14 notes signed**, and each visit shows **Note signed**, **Note not signed** or **No note yet**. Reception sees these statuses but never the notes themselves.

## Who reads a note

Only the practitioner who wrote a note and the clinic owner can read it. Reception and other practitioners see that notes are private instead. Every read is recorded in the file's access audit.
