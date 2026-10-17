# Balm demo

`rer demo` runs a throwaway copy of Balm signed in as the owner of **Cedar Grove
Physical Therapy**, a sample clinic: four practitioners (the owner treats clients
too), reception, a week of past visits and a week of bookings ahead in every
state, completed intake forms, private treatment notes, approved, part-paid and
outstanding invoices, and an invoice, two reminders and an intake form update
waiting for a person's approval. The sample data is `src/demo.ts`, built with
Balm's own domain code; it runs once, after the owner exists.

The app and title read **Balm Demo**. There is no demo bar and no mail outbox:
the intake email a booking sends, and staff sign-in invitations, report as sent
and nothing leaves. Balm makes no other outbound calls. The demo's data lives in
`.rer/demo/` and is deleted when it stops; the checkout's `.wrangler/state` is
never touched.

The hosted demo at https://demo.run-balm.com gives each visitor their own copy
on rer's native Worker host (`deploy-demo.json`, `.github/workflows/run-demo.yml`).
A copy ends after 60 minutes, 15 idle minutes or on sign-out. Base's guide is
[DEMO.md at rer-v0.2.38](https://github.com/runeditrun/base/blob/rer-v0.2.38/default-seed/DEMO.md).
