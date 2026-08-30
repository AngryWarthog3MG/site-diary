# Reviewing a change to Site Diary

For a second agent reviewing a diff it did not write. The job is to find what the author
rationalised, not to restyle the code.

Review the diff against `AGENTS.md`. The checks below are ordered by how badly the failure
lands: the top ones corrupt a legal record silently, the bottom ones are ordinary bugs.

## 1. Does it invent, default, or carry forward a value?

The hardest rule in this codebase is that an unstated value stays null and the app asks.
Flag any new default, fallback, coalesce, "sensible" placeholder, or value copied from a
previous entry that reaches a diary field. A missed value gets asked about; an invented one
gets signed and never questioned again.

## 2. Does it weaken immutability?

Any path that updates or deletes a signed entry, its child rows, or its stored PDF. This
includes "just regenerating" a PDF as part of a fix. Corrections are a new superseding
entry — nothing else.

## 3. Does it change what the content hash covers?

`canonical_entry_json` is the hash input. If the diff adds, removes, or reorders anything
inside it, every already-signed entry becomes unverifiable. That needs a re-hash migration
and an explicit decision, not an edit. Check `supabase/migrations/` for one.

## 4. Does it change a diary field in fewer than five places?

Migration (+ `npm run db:types`) → extraction schema and prompt → review schema and screen
→ gap rules → PDF template. A field missing from extraction is captured by nobody; a field
missing from the PDF does not exist as far as a claim is concerned. Name any layer the diff
skipped.

## 5. Are the gap rules still implemented twice and in agreement?

Blocking gaps live in TypeScript (live prompts) and in a database trigger (the real gate).
A change to one without the other is a bug even when tests pass. The database wins; the
client half is pinned by `src/lib/review/schema.test.ts`.

## 6. Does it introduce PDF nondeterminism?

Anything fetched over the network at render time, `Date.now()`, `toLocaleString`, locale or
timezone-dependent formatting, or ordering by row id rather than by content. If
`src/lib/pdf/` changed at all, `npm run pdf:check` must have been run.

## 7. Extraction

- Any field made optional rather than required-but-nullable.
- A prompt or schema change without `npm run extraction:eval` — and invention in that eval
  is a harder failure than a miss.
- Anything writing extraction output straight to a child table instead of
  `entry_extractions`. The supervisor confirms; the model proposes.
- A `source_quote` that is not verbatim from the transcript.

## 8. Weather

Readings recorded whose window does not belong to the entry date; observations replaced
rather than merged across the day; a manual reading overwritten; the 50 km station cap
loosened; provenance columns dropped.

## 9. Generated SQL and the query layer

Views must stay `security_invoker`; the executor read-only with an empty `search_path`;
relations schema-qualified. Treat any new reliance on `src/lib/query/validate.ts` for
*safety* as a finding — it exists for readable errors.

## 10. Security and ops

New table without RLS enabled; a policy granting `anon`; an environment value printed or
logged; an edit to an already-applied migration; a service worker change with no `VERSION`
bump in `public/sw.js`; unanchored `.vercelignore` patterns.

## 11. Nil versus gap

A confirmed nil and an unanswered section must remain distinguishable everywhere they
surface — database, review screen, PDF. Anything that collapses them is a finding.

## 12. Tests

New logic with no test. `npm test` is the gate; `npm run test:all` adds the PDF assertion.

## Reporting

Report findings ranked most severe first. For each: the file and line, one sentence on the
defect, and a concrete failure scenario — inputs or state that produce the wrong record.
Say plainly when a check does not apply to this diff rather than padding the list. No
finding is better than a speculative one.
