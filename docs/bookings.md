## Online booking

Your booking page is `/book` on your Balm's address. A new client:

1. Chooses a service and a practitioner, and selects **Show available times**.
2. Picks a time. Times start every 15 minutes inside the practitioner's weekly hours, at least two hours ahead and up to 60 days out, shown in the clinic's time zone. **Show the next week** moves on.
3. Enters their name, date of birth, email and, if they like, their mobile number, agrees that the clinic keeps their details and health information, and selects **Book this appointment**.

They land on their private intake link, which is also emailed to them when mail is set up. If someone else took the same time a moment earlier, the booking is refused and they choose another.

A client whose name, date of birth and email exactly match an existing file continues that file with a practitioner they have already seen; a new practitioner is booked from the signed-in patient portal. One email address can hold at most three upcoming online bookings. Set **Online booking** to **Closed** on the **Clinic** page to stop taking bookings.

## The schedule

**Schedule** is the clinic's calendar, in the clinic's time zone: everyone's for the owner and reception, and their own for a practitioner.

- **Day** shows one column per practitioner; **Week** shows the seven days, Sunday to Saturday, for the practitioner you choose under **Practitioner**. **Previous**, **Today** and **Next** move by a day or a week.
- With rooms set up (see [Set up your clinic](/docs/set-up-your-clinic)), the owner and reception can switch to **Rooms**: one column per room, plus **No room** for visits without one. With equipment set up, **Equipment** shows one column per item (a pool, an AlterG).
- Each card also carries its flags: **Intake due** or **Intake in**, the authorization that covers it ("10 of 12 visits left", counting attended and booked visits), and for the owner and reception the patient's balance owed.
- Under **Day view**, **Print day sheet** opens the shown day as a page to print and **Export day sheet (CSV)** downloads it, with the same practitioner, room or equipment filter.
- Each visit shows its time, the client, the service, the room or practitioner, and its status: **Booked**, **Attended** or **Did not attend**, with **Series** for a recurring visit and **Waitlist** for one booked from an offer. Canceled visits leave the calendar and stay in the list under it. Shaded times are outside the practitioner's hours.
- Under the calendar, the same day or week as a list.

## Move or cancel a visit

Select a visit to open it under the calendar.

- **Move this visit**: choose a new date, start time, practitioner (owner and reception) or room, and select **Move visit**. On a computer you can also drag the visit onto a free time instead.
- **Mark attended** or **Did not attend**, from one hour before the start time.
- **Cancel this visit** at any time before then. When the visit is at least two hours ahead, its time is offered to the [waitlist](/docs/waitlist).

A move is checked exactly like a booking: it must sit inside the practitioner's hours, and Balm refuses it when it would overlap another visit of that practitioner, or another visit in the same room. Nothing changes when a move is refused.

## Book from the schedule or a client file

Select an empty time in the calendar, or use **Book a visit** under it, or open **Clients**, then the file, then **Book an appointment**. Choose the client, the practitioner, the service, a room if you use them, the date and the start time in the clinic's time zone. Reception and the owner book for anyone; a practitioner books their own calendar, for a patient already in their care or one no practitioner has seen yet. The time must sit inside the practitioner's hours and must not overlap another booking of that practitioner or that room.

After booking, Balm shows the client's private intake link once, and emails it when the client has an email address and mail is set up.

To add someone first, use **Add a client** on the **Clients** page.

## Recurring visits

For a plan of care such as twice a week for six weeks, open **Book recurring visits** (in a client's file, or under the calendar):

1. Choose the practitioner, the service and, if you like, a room.
2. Check each weekday under **Every**, set the **Start time**, **For how many weeks** and the **Starting** date, and select **Check the dates**.
3. Balm lists every date with **Free** or the reason it can't be booked: it overlaps another visit (shown with that visit's time), the room is booked, or it is outside the practitioner's hours. Nothing is saved yet.
4. For each date that can't be booked, change its time or check **Skip**, then select **Check again**. **Book** stays unavailable until every date is free or skipped; Balm never drops a date on its own.
5. Select **Book N visits**. All of them are booked at once, or none if someone took one of the times a moment earlier. The intake link goes with the first visit, and skipped dates are recorded with the series.

Select a visit of a series to change one visit or the rest:

- **Move this visit** or **Cancel this visit** changes that visit only.
- **Move this and the later visits in the series** gives each remaining visit a new start time (and, if you like, practitioner or room) on its own date. If any of them would overlap or fall outside hours, nothing moves and those dates are listed.
- **Cancel this and the rest of the series** cancels that visit and every later one.

An attended visit is ready for its invoice: see [Invoices and payments](/docs/invoices).
