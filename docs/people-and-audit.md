## Roles

| Role | Sees and does |
| --- | --- |
| Owner | Everything: clinic settings, staff, every client file with intake answers and notes, invoices, the access audit, move-in and agent keys. |
| Practitioner | Only clients booked with them: their files, intake answers and their own notes. They book their own calendar and mark their own visits. |
| Reception | Every client file, bookings, invoices, payments and reminders, never intake answers or treatment notes. |
| Agent key | Prepares invoices, reminder text and intake versions for a person to approve. Never reads notes or intake answers. **Agent access** shows how to connect ChatGPT or an assistant on your computer step by step. |

## Sign in with Auth

By default everyone signs in with an email link. A clinic that runs [Auth](https://run-auth.com), the open-source sign-in service from Run Edit Run, can link it so invited staff sign in with their Auth account (a passkey or Auth's own email link), and turning someone off in Auth signs them out of Balm too. Balm links only to Auth; Google Workspace, Microsoft 365 and Okta cannot be linked to Balm directly, but Auth can pass sign-in on to them.

Linking needs a deployed Balm and a deployed Auth, both at `https://` addresses:

1. In Balm, open **Sign-in settings** (top right, owner only), enter Auth's address and select **Connect to Auth**. If Balm asks, select **Email me a confirmation link** and open that email in the same browser, then select **Connect to Auth** again.
2. Within ten minutes, sign in to Auth as an administrator, open **Apps**, enter Balm's address under **Add an app**, then select **Check app** and **Approve app**.
3. Refresh **Sign-in settings** in Balm. It shows "Linked to Auth". Check **Allow provider sign-in** and select **Save settings**; the page confirms it.

Each staff member still needs a Balm invitation, and an Auth account with the same email address. Email links keep working for everyone.

## Remove someone's access

On **Clinic**, edit the staff member and set **Status** to **Inactive**. They are stopped on their next request. To stop an assistant, revoke its key under **Agent access**.

## Erase a record

Health records are kept. The owner can erase a client only when the file has no appointments, intake, notes, invoices or import history, and a staff member only when they were never invited and never used in clinic work. Erasing replaces their personal details for good; deactivate anyone else instead.

## The access audit

At the foot of every client file, the owner sees who opened the file, read the intake answers or notes, changed something, downloaded an invoice or reminder, or read the client's name through an agent key, and when. Your own view of the page is recorded too. Nobody, the owner included, can change or delete an audit row, and rows carry no client details. The newest 50 entries come first, with the total count; **Older entries** pages back 50 at a time and **Newest entries** returns to the top. Times are in the clinic's time zone, labeled with it.
