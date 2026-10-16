## The intake link

Every booking gets a private, one-use link to the current intake form. The client opens it, answers the questions and selects **Send my intake form**. The form can be sent once; the link then shows when it was received.

The answers appear in the client's file under **Intake forms**, for their practitioner and the owner. Reception sees only that the form was received. Each set of answers keeps the exact version of the form it answered.

## The questions

The first version, **New client intake**, asks:

- What brings you in? (required)
- How long has this been going on, and has it happened before?
- Medical conditions, injuries or surgeries we should know about
- Current medications
- Emergency contact name and phone (required)
- A consent to assessment and treatment (required)

## Publish a new version

On **Intake form** (owner only):

1. Under **Prepare a new version**, edit the **Form title** and the **Questions**. Each question has an `id` (lowercase), a `label`, a `type` and `required` (true or false). The types are `short`, `long`, `yes` (a checkbox) and `date`.
2. Select **Prepare draft**. Nothing changes for clients yet.
3. Under **Prepared versions**, check the draft and select **Publish as the new version**.

New bookings get the new version. Published versions never change, and earlier versions stay listed with their dates.

```json
[{"id":"reason","label":"What brings you in?","type":"long","required":true},{"id":"insurance","label":"Insurance plan and member ID","type":"short","required":false}]
```
