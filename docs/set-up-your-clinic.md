Until these steps are done, the owner's **Schedule** page shows them under **Finish setting up**. Everything here is on the **Clinic** page, which only the owner sees.

## Clinic details

1. Enter the **Clinic name**.
2. Check the **Time zone**. Until you save it, Balm fills in your browser's time zone; US zones are listed first by name (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii), then every other zone. Every date and time Balm shows, on pages, emails, invoices and plans of care, is in this zone.
   You can change it later. Booked visits keep their exact moment and show at the matching clock time in the new zone, so the page asks you to tick a box confirming that when visits are booked. Weekly hours stay the same clock times.
3. Add a **Tax ID** and the **Address**: both appear on invoices, and the address on reminders.
4. Leave **Online booking** on **Open** to take bookings at `/book`, or set it to **Closed**.
5. Select **Save clinic details**.

## Services

Add each service a client can book with its **Length (minutes)** and **Price in cents**: `14000` is $140.00. For example an initial evaluation of 60 minutes at `14000` and a follow-up visit of 45 minutes at `9500`. Set a service to **Inactive** to stop offering it. Choose the template its notes start from under **Notes for this service start from**, for example **PT initial evaluation** for the evaluation and **PT daily note** for the follow-up.

## Rooms

Rooms are optional. Add each treatment room or gym under **Rooms** on the **Clinic** page. A room holds one visit at a time: Balm refuses a booking, a move or a recurring visit that would put two visits in one room at once. The schedule can then show each room's day or week.

## Staff

Add each person under **Add a staff member**:

- **Practitioner**: treats clients. Their **Profession** (for example `Physical Therapist`) and **Provider number** (for example their NPI) appear on invoices. Their **Credentials** (for example `PT, DPT`, `OTR/L` or `CCC-SLP`) appear in their signature on notes and plans of care. If you treat clients yourself, add yourself as a practitioner with your own sign-in email.
- **Reception**: runs the front desk. They see every client file, but never intake answers or treatment notes.

Select **Invite to sign in** next to each person. A deployed Balm emails the invitation, and the person opens it in any browser.

Balm on your computer sends no email, and its links open only in a browser that has opened Balm with rer's link. To work as a staff member there, run `rer dev --as person@example.com` (with their email) in the Balm folder and open the `RER_OPEN` link it prints, in another browser or browser profile. The **Clinic** page says this under each person.

## Weekly hours

Under each practitioner, open **Set weekly hours**. For each day of the week:

1. Tick **Works on Monday** (and so on) for the days they work, and untick the others.
2. Enter **Starts** and **Ends**, for example 8:00 AM and 4:00 PM.
3. For a lunch or other break, enter **Break from** and **Break until**. Nobody can book inside a break. After you save, another empty break row appears for a second break.
4. Select **Save hours**.

A new practitioner starts with Monday to Friday, 9:00 AM to 5:00 PM ticked, so check it before saving. The saved hours are listed under their name, for example "Monday 9:00 AM–12:00 PM, 1:00 PM–5:00 PM". Times are clock times in the clinic's time zone. A practitioner with no hours cannot be booked.

## Scribe

The scribe drafts treatment notes from a practitioner's dictation, using your clinic's own AI model. The **Scribe (AI drafting)** card is at the bottom of the **Clinic** page.

1. Create an API key with your provider. For Anthropic, open [API keys](https://platform.claude.com/settings/keys) and choose **Create key**. Any provider with an OpenAI-compatible Chat Completions endpoint that answers in JSON schema also works.
2. Choose the **Provider** and paste the **API key**. Leave **Model** and **Endpoint** blank for Anthropic's defaults, or enter your provider's. If Anthropic answers that your key is not scoped to a workspace, also enter the **Anthropic workspace ID**.
3. Select **Save scribe settings**. The key is stored encrypted and is never shown again; the card shows only its last four characters.
4. Select **Test the scribe**. It sends one made-up dictation, never a patient's, and shows what came back.

Practitioners' dictation goes to this provider. Before you enter real patient details, use a provider that has signed a HIPAA business associate agreement with your practice. **Remove the key** turns the scribe off. On RER Managed hosting, the card says the scribe is not available yet.

## Next

Share your booking page: [Bookings and the schedule](/docs/bookings).
