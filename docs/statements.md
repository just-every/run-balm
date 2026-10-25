# Patient statement cycles

Record each patient’s monthly statement authorization and delivery preference in their file under Statement delivery. Mail needs a complete address. An account hold prevents new cycles; returned mail sets that hold until staff verify the address and record the corrected preference.

The scheduler issues one cycle per calendar month, including a missed first tick. Staff can also run that month from Invoices and reminders. Any date in a month identifies the same cycle. Configure the minimum balance under Clinic. Only balances above that minimum qualify, and accounts awaiting an insurance adjudication are excluded. Balances at least 30, 60 and 90 days old receive progressively stronger requests to contact the clinic, without collections or fees.

Each issued PDF is fixed. Patients find every original under Statements in their portal; the file also provides individual originals for printing. Later payments change the next statement and current balance, while earlier originals retain their bytes and amounts.

Print mail batch downloads a native Letter PDF with separate sender and recipient windows on each statement’s first page. Print at actual size and check alignment against the practice’s double-window envelope stock. The vendor CSV contains batch and statement identifiers, the patient name and address, cents and the exact statement PDF encoded as base64. Its total counts mailed statements only. This is a local export, with no automatic vendor transmission: use the practice’s approved BAA-backed service when handing the file off.

Preparing or downloading a batch does not mark it mailed. Record the actual mailing date and postal or clinic reference in the patient’s file; record returned mail there too. The delivery ledger retains channel, actual outcome, date and batch. Email acceptance means the provider accepted the notice, and text submission means its provider queued it. Neither claims that a patient read it. Uncertain sends are never automatically retried; check the provider before contacting the patient again.
