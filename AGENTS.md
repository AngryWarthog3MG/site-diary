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
- `src/lib/weather/` — BOM fetch, parse, window handling, provenance
- `src/lib/query/` — `diary` view schema description, SQL validation, the three calls
- `src/lib/weekly/`, `src/lib/monthly/` — reports
- `supabase/migrations/` — append only; never edit an applied migration
- `README.md` — the design record, including why each decision went the way it did.
  Read the relevant section before changing behaviour in that area.

## Changing a diary field touches five places

Change three of them and the app silently stops capturing what supervisors say. In order:

1. **Migration** + `npm run db:types`
2. **Extraction** — `src/lib/extraction/schema.ts` and `prompt.ts`, plus fixtures
3. **Review** — `src/lib/review/schema.ts` / `fields.ts` and the review screen
4. **Gap rules** — the TypeScript half *and* the SQL trigger (see below)
5. **PDF** — `src/lib/pdf/docket.tsx`. A field that doesn't reach the export doesn't
   exist as far as a claim is concerned.

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
- **Weather windows must belong to the entry date.** BOM windows move through the day;
  recording tonight's minimum as today's is inventing a number. Observations merge across
  the day rather than replace, manual readings are never overwritten, and nothing is taken
  from a gauge over 50 km away.
- **Generated SQL is safe because of `security_invoker` views, a read-only transaction, an
  empty `search_path`, and a timeout** — in that order. `src/lib/query/validate.ts` exists
  for readable errors, *not* for safety. The file says so; believe it.
- **`entry_date` comes from the device**, not the server. A Perth knock-off at 17:30 is
  already tomorrow in UTC.
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
- `npm run extraction:eval` costs real tokens. Run it when the prompt or schema changed,
  and treat invention (a value nobody said) as a harder failure than a miss.
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
