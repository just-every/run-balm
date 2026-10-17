Until these steps are done, the owner's **Schedule** page shows them under **Finish setting up**. Everything here is on the **Clinic** page, which only the owner sees.

## Your clinic's time zone

Balm assumes no time zone. Right after **Finish setup**, its first page asks for your clinic's: it fills in your browser's zone, names it (for example "This browser is set to Central (Chicago)"), and lists US zones first. Check it, enter the clinic name, and select **Save and open the schedule**. Until it is saved, the schedule stays closed and `/book` tells patients online booking is not open yet. Every time Balm shows afterwards (the schedule, booking, reminders, the access audit, approval deadlines) is in this zone and labeled with it.

## Clinic details

1. Enter the **Clinic name**.
2. Check the **Time zone** you chose at setup. US zones are listed first by name (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii), then every other zone. Every date and time Balm shows, on pages, emails, invoices and plans of care, is in this zone.
   You can change it later. Booked visits keep their exact moment and show at the matching clock time in the new zone, so the page asks you to check a box confirming that when visits are booked. Weekly hours stay the same clock times.
3. Add a **Tax ID** and the **Address**: both appear on invoices, and the address on reminders.
4. Leave **Online booking** on **Open** to take bookings at `/book`, or set it to **Closed**.
5. Select **Save clinic details**.

## Services

Add each service a client can book with its **Length (minutes)** and **Price ($)**, for example an initial evaluation of 60 minutes at `140.00` and a follow-up visit of 45 minutes at `95.00`. Every amount you type in Balm is in dollars. Set a service to **Inactive** to stop offering it. Choose the template its notes start from under **Notes for this service start from**, for example **PT initial evaluation** for the evaluation and **PT daily note** for the follow-up.

## Rooms

Rooms are optional. Add each treatment room or gym under **Rooms** on the **Clinic** page. A room holds one visit at a time: Balm refuses a booking, a move or a recurring visit that would put two visits in one room at once. The schedule can then show each room's day or week.

## Staff

Add each person under **Add a staff member**:

- **Practitioner**: treats clients. Their **Profession** (for example `Physical Therapist`) and **Provider number** (for example their NPI) appear on invoices. Their **Credentials** (for example `PT, DPT`, `OTR/L` or `CCC-SLP`) appear in their signature on notes and plans of care. If you treat clients yourself, add yourself as a practitioner with your own sign-in email.
- **Reception**: runs the front desk. They see every client file, but never intake answers or treatment notes.

Select **Invite to sign in** next to each person. A deployed Balm emails the invitation and says so at the top of the page (“Invitation sent to …”); the person opens it in any browser. Select it again to send a new link. Once your clinic links Auth under **Sign-in settings**, invited staff can also sign in with their Auth account: see [People and the access audit](/docs/people-and-audit).

Balm on your computer sends no email, and its links open only in a browser that has opened Balm with rer's link. To work as a staff member there, run `rer dev --as person@example.com` (with their email) in the Balm folder and open the `RER_OPEN` link it prints, in another browser or browser profile. The **Clinic** page says this under each person.

## Weekly hours

Under each practitioner, open **Set weekly hours**. For each day of the week:

1. Check **Works on Monday** (and so on) for the days they work, and uncheck the others.
2. Enter **Starts** and **Ends**, for example 8:00 AM and 4:00 PM.
3. For a lunch or other break, enter **Break from** and **Break until**. Nobody can book inside a break. After you save, another empty break row appears for a second break.
4. Select **Save hours**.

A new practitioner starts with Monday to Friday, 9:00 AM to 5:00 PM selected, so review it before saving. The saved hours are listed under their name, for example "Monday 9:00 AM–12:00 PM, 1:00 PM–5:00 PM". Times are clock times in the clinic's time zone. A practitioner with no hours cannot be booked.

## Scribe

The scribe drafts treatment notes from a practitioner's dictation, using your clinic's own AI model. The **Scribe (AI drafting)** card is at the bottom of the **Clinic** page.

1. Create an API key. For Anthropic (Claude), open [API keys](https://platform.claude.com/settings/keys), choose **Create key**, pick the workspace the key belongs to, and copy the key (it starts with `sk-ant-`).
2. Paste the **API key** and select **Save and test**. Balm sends one made-up dictation, never a patient's, and the card shows **Ready** only when the draft comes back right. Otherwise it shows **Not working** and the reason.
3. If the reason says Anthropic needs a workspace, open [Workspaces](https://platform.claude.com/settings/workspaces), open the workspace, copy its ID (it starts with `wrkspc_` and is the last part of that page's address), paste it into **Anthropic workspace ID**, and select **Save and test** again.

Not using Anthropic? Choose **Other (OpenAI-style)** for OpenAI or any provider that accepts the same requests, open **Model and web address**, and enter the model name and the web address of its chat API that your provider gives you. The key is stored encrypted and is never shown again; the card shows only its last four characters. **Test again** repeats the test at any time.

Practitioners' dictation goes to this provider. Before you enter real patient details, use a provider that has signed a HIPAA business associate agreement with your practice. **Remove the key** turns the scribe off. On RER Managed hosting, the card says the scribe is not available yet.

## Next

Share your booking page: [Bookings and the schedule](/docs/bookings).
