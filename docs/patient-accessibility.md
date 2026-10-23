# Patient accessibility status

Balm does not yet claim WCAG 2.2 AA conformance. This checklist is dated **23 October 2026**. English/Spanish UI coverage is partial; patient messages, clinical text and practice-authored materials are not automatically translated.

The patient selects English or Spanish in the portal and the choice is remembered on their patient file without invalidating their session. The portal's sign-in page also offers the two display languages. Selected portal headings, navigation, sign-in, exercise and action labels are translated. The remaining English copy is still a known gap.

Automated checking uses pinned `axe-core@4.11.0`, running its `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` tags. The public-door language journey in `tests/portal.test.mjs` invokes `tests/viewport-proof.mjs` with `BALM_AXE=1` and a private `BALM_UI_SCREENSHOTS` directory. The English/Spanish portal home and sign-in checks at 1440 and 390 pixels pass with zero serious or critical violations. This covers those states only; it does not establish conformance for every patient page or PDF.

| Page | English/Spanish coverage | axe | Keyboard-only completion | Focus/names/announcements with VoiceOver and NVDA | 200% zoom / 320px reflow | Errors/suggestions / extendable timing |
| --- | --- | --- | --- | --- | --- | --- |
| Portal sign-in | Partial UI | Pass: both language selections at 1440/390 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Portal home, program and messages | Partial UI; clinical content retained | Pass: both language selections at 1440/390 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Portal follow-up scheduling | English | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Booking | English | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Intake | English, practice-authored questions | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Consent/renewal | English, practice-authored documents | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Reminder visit/reply | English | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Payment and statement pages/PDFs | English | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Record/program PDFs | English text; print illustrations incomplete | NOT RUN (PDF) | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

A human using VoiceOver and NVDA must complete Spanish booking and intake and record results for every page, including keyboard-only operation, visible focus, names/announcements, error recovery, zoom/reflow and timing extension. Browser DOM checks cannot substitute for those screen-reader results. The checklist remains open until these are actually performed.
