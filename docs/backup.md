## Export

Stop Balm first, and keep exports private: they contain health records. The `exports/` folder and every `.rer` file are git-ignored, so `git add .` never commits a backup; copy them somewhere encrypted that only you can open.

```sh
rer dev --stop
rer export --output exports/balm.rer
```

The archive holds the clinic settings, staff, clients, appointments, intake answers, notes with every revision, invoices, payments, approvals, the access audit and move-in journals. Sessions, sign-in links, agent keys and secrets are not included: everyone signs in again.

## Restore

Restore into a fresh copy of the same version of Balm, before setup and before any data:

```sh
rer install
rer import --input ~/backups/balm.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

Setup must use the archived owner's email. A damaged archive, or a copy that already holds data, is refused.

## After an erasure

Pass a later archive as the journal so an older backup cannot bring erased details back:

```sh
rer import --input OLD.rer --journal LATER.rer --yes
```

`rer reset --yes` deletes the local data and settings; export first if you need them.
