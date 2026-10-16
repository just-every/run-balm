Until these steps are done, the owner's **Schedule** page shows them under **Finish setting up**. Everything here is on the **Clinic** page, which only the owner sees.

## Clinic details

1. Enter the **Clinic name**.
2. Enter the **Time zone** as an IANA name, for example `America/New_York`, `America/Chicago`, `America/Denver` or `America/Los_Angeles`. Every time Balm shows is in this zone. It cannot change after the first booking.
3. Add a **Tax ID** and the **Address**: both appear on invoices, and the address on reminders.
4. Leave **Online booking** on **Open** to take bookings at `/book`, or set it to **Closed**.
5. Select **Save clinic details**.

## Services

Add each service a client can book with its **Length (minutes)** and **Price in cents**: `14000` is $140.00. For example an initial evaluation of 60 minutes at `14000` and a follow-up visit of 45 minutes at `9500`. Set a service to **Inactive** to stop offering it.

## Staff

Add each person under **Add a staff member**:

- **Practitioner**: treats clients. Their **Profession** (for example `Physical Therapist`) and **Provider number** (for example their NPI) appear on invoices. If you treat clients yourself, add yourself as a practitioner with your own sign-in email.
- **Reception**: runs the front desk. They see every client file, but never intake answers or treatment notes.

Select **Invite to sign in** next to each person. Balm on your computer puts the invitation under **Local mail**; a deployed Balm emails it.

## Weekly hours

Under each practitioner, open **Set weekly hours**. Hours are one entry per block of time: `weekday` 0 is Sunday, 1 is Monday and so on to 6 for Saturday; `start` and `end` are 24-hour clinic times.

```json
[{"weekday":1,"start":"08:00","end":"16:00"},{"weekday":4,"start":"08:00","end":"18:00"}]
```

That is Monday 08:00–16:00 and Thursday 08:00–18:00. A practitioner with no hours cannot be booked.

## Next

Share your booking page: [Bookings and the schedule](/docs/bookings).
