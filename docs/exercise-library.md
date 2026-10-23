# Exercise library

Balm currently includes a **23-exercise starter collection**, comprising 13 PT, 5 OT and 5 SLP exercises. The planned 1,500-exercise collection (900 PT, 350 OT, 250 SLP) is incomplete. This page does not claim those counts have shipped.

The original English and Spanish instructional text and line illustrations in `src/balm/portal/library-data.ts` are dedicated to the public under **CC0 1.0 Universal**: https://creativecommons.org/publicdomain/zero/1.0/. Source: original Balm project work, 2026. That dedication applies to these exercise assets; the rest of Balm retains its existing license. The exercise detail and assigned patient program show the source and license. No third-party exercise collection or licensed CPT content is bundled.

A treating clinician searches the patient's **Exercise library** by words, discipline, region and equipment, selects exercises, reviews or edits each item’s sets, reps, hold and frequency, selects a saved note and assigns the program. Every assigned item keeps its original English and Spanish instructions, illustration, source, license and dosage. Later practice imports cannot rewrite an assigned exercise. Adjustments are new assignments; archive the old one. Review the individual's condition, precautions and dosage before assigning any exercise. Swallowing items do not prescribe food or liquid trials or new swallow maneuvers.

The patient sees the program, logs completion and an optional 0–10 pain score for a clinic-local date within the last 30 days, and downloads a printable PDF with the shipped line illustrations. Each exercise has at most one session per date; repeating a completion does not change the original pain score. The chart and later note display the dated adherence. The PDF includes the shipped line illustrations and the assigned English and Spanish instructions; practice-uploaded raster images are not embedded yet. A complete 1,500-item library and richer program grouping remain pending.

## Import the practice's exercises

In the patient's chart, open **Import practice exercises with images**. Upload a UTF-8 CSV plus up to three media files in the form, and confirm that the practice has the rights to all text and images. The command API accepts a `media` object mapping original filenames to PNG, JPEG or WebP data URLs for larger reviewed batches. SVG, remote URLs, pathnames and files over 1 MB are refused. The CSV contains 1–100 exercises per atomic import and these exact columns:

```csv
title,title_es,instructions,instructions_es,discipline,region,position,equipment,sets,reps,hold_seconds,frequency,media
Practice grip task,Tarea de agarre de la clínica,Follow your therapist's demonstrated grip task.,Siga la tarea de agarre que le mostró su terapeuta.,ot,hand,seated,soft ball,1,5,0,Once daily,grip.png
```

Quoted commas, double quotes and newlines follow RFC 4180. Discipline is `pt`, `ot` or `slp`. A missing image or invalid row refuses the whole batch. Repeating the same exercise content and image is a no-op. Uploaded practice content is labeled practice-owned; it does not inherit the shipped collection's CC0 dedication. Originals travel with whole-clinic archives. Imported practice templates have no patient data; assigned copies are patient records protected by the existing erasure, retention and archive rules.

Public doors: `GET /api/balm/exercises?q=resistance%20band&discipline=pt&region=shoulder`, native `exercise.library.import` (`csv`, `media`, `rights:true`) and `exercise.program.assign` (`clientId`, `noteId`, `exerciseIds`). Reception, agents and unrelated practitioners cannot assign a patient's clinical program.
