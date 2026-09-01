# Giving the Site Diary demo

Fifteen minutes, one phone, one laptop. The story: **a supervisor talks for 90
seconds at knock-off, and the company gets a claim-grade record.**

## Before the demo

```bash
npm run seed:demo        # idempotent — five signed days on Test Site
```

Wake the sandbox so it appears in pickers, and mint a sign-in QR:

```bash
npx supabase db query --linked "update projects set active = true where code = 'T001'"
npm run signin -- --email danny.test@example.com --qr
```

Put Test Site back to sleep afterwards (`active = false`, same query).

## The arc

1. **Capture** (phone): open the app, hit record, talk a day in — crew, a pour
   with docket numbers, a delay. Show it saving with no signal (flight mode) —
   the recording is held on the phone and sends itself later.
2. **Review** (phone): the extracted docket. Tap a field, show the source
   quote — *"it only writes down what was said, and shows you where."* Show a
   docket photo being read (volume corrected from the docket, difference
   shown). Sign it.
3. **The record** (laptop): the signed entry — serial, timestamp, SHA-256.
   *"Signed entries can never be edited. Corrections are new entries. That is
   enforced by the database, not the app."*
4. **The week** (laptop): Weekly report → generate the PDF. Read the
   commentary out loud — it tracks progress across the week, prices the idle
   plant, and flags the DBYD/depth discrepancy as a latent condition. *"That
   is a contracts administrator's first draft, from voice notes."*
5. **Ask** (laptop): type *"What happened with the Telstra crossing?"* — the
   answer assembles the story across two entries with citations. Then
   *"How many hours did we lose to rain last week?"* — 4 hours, 5 personnel,
   cited. *"It never answers from outside the record. No rows, no answer."*
6. **Close**: the timesheet CSV and the monthly bundle — payroll and the
   head-contract archive from the same 90 seconds a day.

## Lines that land

- "Supervisors estimate; dockets don't — the docket wins and the difference is shown."
- "If nothing is recorded, nothing can be substantiated. The app shows the gaps."
- "Every number in the commentary is checked against the record. If the AI
  invents a figure, the report ships without commentary rather than with it."
