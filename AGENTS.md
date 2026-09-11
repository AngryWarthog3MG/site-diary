<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Site Diary

A daily site diary for construction supervisors. Voice in, structured record out.

The output is **evidentiary** — it is what an EOT or variation claim stands on months
later. That is the whole reason this app is shaped the way it is, and it is why several
things below look over-engineered for a note-taking app. It is not a note-taking app.

## Non-negotiables

Do not optimise these away. Each one is enforced in the database, not just the UI.

1. **Nothing is stored without the supervisor confirming it.** Extraction writes a
   *proposal* to `entry_extractions` and touches none of the child tables. The review
   screen is not a formality — it is the point.
2. **Signed entries are immutable.** No edits, ever. Corrections are a new entry that
   supersedes the original. Never regenerate or delete a stored PDF as part of a fix —
   the stored document is the record.
3. **The daily PDF contains no AI-generated text** and renders deterministically. The
   same entry re-rendered must be byte-identical.
4. **Never invent a number.** Unstated means null and the app asks. Zero rows answers
   "no records found" — never a guess. Nothing is carried forward from yesterday.
5. **Raw audio and raw transcript are retained on every entry.** That is the provenance
   trail when a number is disputed.
6. **Offline-first capture.** Recording, queuing and local draft storage work with no
   connection. Sites have bad signal; assume none.

## Stack

Next.js 16 (App Router) + TypeScript on Vercel `syd1` · Supabase Postgres 17 (project
`site-diary-prod`, `ap-northeast-1`) with RLS on every table · Deepgram nova-3 for
transcription · Anthropic `claude-sonnet-4-6` for extraction and query, `claude-haiku-4-5`
for routing · BOM observations over anonymous FTP · Chromium via Playwright for PDF.

Production: `https://site-diary-eight.vercel.app` (the `-eight` host is the public one).

## Commands

```bash
npm run dev          # local
npm test             # typecheck + unit tests — the gate for any change
npm run db:test      # SQL suites
npm run pdf:check    # byte-identical PDF assertion; run if src/lib/pdf/ changed
npm run test:all     # npm test + pdf:check — does NOT include db:test
npm run db:types     # regenerate src/types/database.ts after a migration
```

Deployment has its own procedure — see `docs/ship.md`. Do not deploy by
improvising; the register once shipped dead because a live smoke test was skipped.

## Layout

- `src/lib/capture/` — recorder, IndexedDB queue, sync, live socket, PCM conversion
- `src/lib/extraction/` — JSON contract, prompt, the call, completeness check, scorer,
  20 transcript fixtures
- `src/lib/review/` — payload contract, gap rules, field definitions
- `src/lib/pdf/` — the one docket template, rendered both to Chromium and to screen
- `src/lib/weather/` — BOM fetch, parse, window handling, provenance; `days.ts` keeps one
  reading per project per day (`project_weather_days`) from the Bureau's daily table
- `src/lib/query/` — `diary` view schema description, SQL validation, the three calls
- `src/lib/documents/` — job documents for Ask: text extraction (typed PDF, Word, scans via
  the model), chunking, indexing into `project_document_chunks`. Reference only, never a diary field; `spec-check.ts`
  backs the review screen's Spec tab (read-only, never stored); `prestart-spec.ts` backs the prestart's Spec tab
  (kept on `prestarts.spec_notes`, printed on the prestart PDF)
- `src/lib/prestart/` — prestart checklist, PDF, spec notes; `dictate.ts` turns a spoken briefing into the
  form's fields (Deepgram → model, never stores, never ticks a check); `dictation-merge.ts` folds it into typed text
- `src/lib/crew/tickets.ts` — tickets (org-wide, by person name) and what each plant kind needs; `crew_inductions`
  per job. The plant form refuses missing/expired, warns on none recorded; the prestart marks the un-inducted
- `src/lib/outbox/` — the forms' offline queue (prestart create/edit/sign-on/finish, toolbox sign-on/finish, plant
  check). Any new form write goes through `runOrQueue(live, queue)` with phone-chosen ids, and its replay in
  `sync.ts`; the PDFs print `completed_on_device_at` alongside arrival via `src/lib/pdf/finished-at.ts`
- `src/lib/plant/` — plant prestarts: `checklist.ts` (per-kind checks, frozen labels), `pdf.tsx`, `on-job.ts`
  (the machines on a job: `project_plant` → `plant_register`, the ONE plant vocabulary — there is no per-job
  plant list any more). Tables `plant_register` (org-wide fleet), `project_plant`, `plant_prestarts` (signed =
  frozen), `plant_defects`. `app.entry_warnings`
  raises `plant_without_prestart`; the TS half is `reviewQualityWarnings(payload, { plantPrestarted })`
- `src/lib/calendar.ts` — `isRestDay`: weekends with nothing recorded are rest days, not holes. One definition for
  the screens, the weekly and the reminder
- `src/lib/claims/` — the claims register loader and the variation register (`register.ts`:
  statuses, summary arithmetic). Status changes only via the `set_variation_status` RPC. A day's variation
  is identified by its register number alone (`variations.register_seq`, picked from a dropdown of
  1–50); the trigger registers by number, never by words or a client reference. Rows on days signed
  before the column existed carry theirs through the link (`public.variation_number`) — read that,
  never assume the column
- `src/lib/weekly/`, `src/lib/monthly/` — reports. `weekly/photos.ts` gathers the week's photographs (embedded,
  one print per photo per day, capped); `img[data-shrink]` in `src/lib/pdf/render.ts` re-encodes marked images
  before printing — never mark an image in the daily docket, its bytes must not change
- `supabase/migrations/` — append only; never edit an applied migration
- `README.md` — the design record, including why each decision went the way it did.
  Read the relevant section before changing behaviour in that area.

## Changing a diary field touches six places

Change four of them and the app silently stops capturing what supervisors say. In order:

1. **Migration** + `npm run db:types` — including the `diary.*` view and, if the field
   belongs in the signed record, `app.canonical_entry_json` (conditionally — an
   unconditional new key invalidates every existing signed hash; see the notes and
   dayworks migrations for the pattern)
2. **Extraction** — `src/lib/extraction/schema.ts` and `prompt.ts` (the prompt must
   actually teach the field, not just carry it in the JSON schema), plus fixtures
3. **Review** — `src/lib/review/schema.ts` / `fields.ts` and the review screen
4. **Gap rules** — the TypeScript half *and* the SQL trigger (see below)
5. **PDF** — `src/lib/pdf/docket.tsx`. A field that doesn't reach the export doesn't
   exist as far as a claim is concerned.
6. **Reports** — `src/lib/weekly/load.ts` + `report.tsx` (and the narrative sees the
   same aggregates automatically). Dayworks skipped this layer once: every daily
   docket showed them while the weekly a PM actually reads showed nothing, and the
   absence read as "none happened". Money leaks through this step, not the others.

## Invariants that break quietly

- **The content hash.** Covers entry identity, transcript, audio, section states and every
  child row; excludes surrogate ids, `created_at` and the signature block. Changing what
  `canonical_entry_json` covers invalidates every signed entry and needs a re-hash
  migration, not an edit.
- **Blocking gaps are implemented twice** — TypeScript for live amber prompts, a database
  trigger that refuses the transition. Change both. If they disagree the database wins.
  `src/lib/review/schema.test.ts` pins the client half against the SQL suite's cases.
- **Extraction fields are required-but-nullable, never optional.** The model must emit
  `null` rather than omit a key, so "not stated" is a positive assertion.
- **Nil ≠ gap.** A confirmed nil prints black; an unanswered section prints amber. Never
  let one render as the other.
- **PDF determinism**: fonts embedded as base64, timestamps and `/ID` rewritten from the
  entry, rows ordered by content never by id, UTC formatted by hand — never
  `toLocaleString`. Each of those was a real bug; see README §P1–P6.
- **`src/lib/extraction/**` runs under plain Node too.** `npm run extraction:eval` loads those
  modules directly with `node`, which has no `@/` alias — so extraction imports must be
  relative, exactly as in the PDF template. A `@/` import there passes typecheck, passes the
  unit tests, ships fine, and breaks only the eval.
- **The docket template compiles standalone.** `tsconfig.pdf.json` builds only
  `src/lib/pdf/**` (plus anything explicitly added to its `include`) to CommonJS for the
  determinism check, and it does not resolve the `@/` alias. So `src/lib/pdf/docket.tsx`
  may import only relatively, and only from modules that build is given. Anything it needs
  from elsewhere goes in a dependency-free leaf module added to that `include` — never an
  import that drags a runtime client (FTP, Supabase) into the PDF build.
- **Weather windows must belong to the entry date.** BOM windows move through the day;
  recording tonight's minimum as today's is inventing a number. Observations merge across
  the day rather than replace, manual readings are never overwritten, and nothing is taken
  from a gauge over 50 km away. `project_weather_days` is a glance and a gap-filler for
  unsigned entries — never the record, never in the hash, never over a manual reading.
- **Generated SQL is safe because of `security_invoker` views, a read-only transaction, an
  empty `search_path`, and a timeout** — in that order. `src/lib/query/validate.ts` exists
  for readable errors, *not* for safety. The file says so; believe it.
- **`entry_date` comes from the device**, not the server. A Perth knock-off at 17:30 is
  already tomorrow in UTC.
- **One document per day, in the database.** `entries_one_open_per_day` (one unsigned entry
  per project-day) and the `entries_one_original_per_day` trigger (no fresh original once a
  day is signed; a correction carries the day's date and supersedes the current version).
  The API returns 409 `day_open` / `day_signed` first; the queue never turns a blocked
  recording into a correction on its own — that is the supervisor's tap.
- **A draft is writable by any authoring role on the job, not only its author** — `app.can_write_entry`
  (SQL) and `canEditEntry` (`src/lib/entries/access.ts`) are the two halves; the signature names the
  signer (`signed_by := auth.uid()`), `author_id` names who started the day. Deleting a draft stays author-only.
- **Roles live in one table.** `src/lib/roles.ts` (`canAuthorEntries`, `canRunTalks`, `canSee`,
  `canManageRegisters`, `canExportReports`) is what the menu, the page guards and the APIs read;
  `app.can_run_talks()` and `app.can_manage_registers()` mirror it in SQL. A new role goes in both.
  Pages refuse a screen with a redirect; hiding the tile is not enough — every RPC and export API
  checks the role itself, because a session can call them without the page.
- **Serials are issued at signing** and follow signing order, not entry date. Sort any
  register by `entry_date`.
- **Bump `VERSION` in `public/sw.js`** when the service worker changes, or phones keep the
  stale cache.

## House rules

- Never print environment values, even masked by name — mask by content.
- `.vercelignore` patterns are unanchored; `supabase/` also matches `src/lib/supabase/`.
  Keep the leading slash.
- Migrations against the hosted DB must be scoped to their own fixtures — it holds real
  signed entries.
- **The evals spend real money and refuse the production key.** `extraction:eval` and
  `docket:eval` read `ANTHROPIC_DEV_API_KEY` (a separate key with a spend cap, in
  `.env.local`, never in Vercel) and stop if it is missing or equals the production key —
  `scripts/dev-key.ts`. One evening of running the eval on the production key drained the
  balance twice and took writing-up and Ask down on site. Run the eval when the prompt or
  schema changed, once, not after every idea; treat invention (a value nobody said) as a
  harder failure than a miss. A full run is ~250k output tokens, about US$4.
- **Drills that write go to the sandbox (T001), never to a live job's draft.** Wake T001
  (`active=true`), run, put it back to sleep in a `finally`. Proving a fix on a real
  supervisor's day is how a real photo got deleted on 2026-09-10.
- **Delete only by the exact id or path you captured when you created the thing.** Never
  "the newest", "the latest", or anything inferred — `apply_entry_review` rewrites every
  child row on each save, so they all share a timestamp. Storage has no undo: a
  `storage.remove` is final. When in doubt, leave the file; the nightly `orphans=1` check
  reports anything the record does not reference.
- **Never hand-roll an orphan re-attach.** A one-off script on 2026-09-10 treated "not in
  `photos`" as "unreferenced" and copied six daywork photographs onto the day as day photos.
  The only definition of "referenced" is `reconcileStorage` (every table that can hold a path);
  to put files back, run `/api/ops/check?orphans=1` and read its report — nothing else.
- **Nothing may sit between "uploaded" and "in the day" that can fail.** A file in storage
  the record does not reference is as good as lost. Add the row (or the payload entry) the
  moment the upload lands, make the code between the two unable to throw, and save at once
  rather than after a debounce — an iPhone reloads a backgrounded page without warning.
- Prefer deleting a feature over weakening a guarantee to make it work. See README §R5.

## More than one agent works on this repo

Claude Code and Codex both read this file. Anything either of them needs lives here or in
`docs/` — never only in `.claude/`, which Codex cannot see.

- `docs/ship.md` — the deploy procedure. The `ship` skill in `.claude/` is a pointer to it,
  so the steps have one home. Change the doc, not the pointer.
- `docs/review.md` — what to check when reviewing a diff you did not write.

**One agent builds, the other reviews.** Never let the same agent write a change and sign
it off; the second pass exists to catch what the first rationalised. Given signed entries
are immutable, the reviewer should not be the one deploying.

**Never run two agents on the same working copy.** Concurrent edits corrupt each other in
ways that read as application bugs. Use a second checkout:

```bash
git worktree add ../"Daily Diary Review" main
```

**The commit is the handoff.** Commit before passing work over, and never hand off a dirty
tree. `next dev` rewrites the block at the top of this file — commit it along with your
work rather than trying to strip it from the diff.
