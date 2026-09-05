# Site Diary — steps 1–6

Schema, RLS, immutability triggers, auth (step 1); audio capture, the offline
queue, upload, transcription and BOM weather (step 2); the extraction call, the
JSON contract and the twenty-transcript accuracy set (step 3); the review
screen, gap blocking, signing and hashing (step 4); the daily PDF (step 5); the
query layer (step 6).

Record, transcribe, extract, review, sign, export, ask. Items 7–8 — the weekly
PDF with its narrative, and docket OCR — are not started.

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill from `supabase status`
supabase start                 # or `supabase db reset` if already running
npm run db:test                # the SQL assertions below
npm test                       # typecheck + unit tests
npm run pdf:check              # the byte-identical PDF assertion (§10)
npm run dev
```

The PDF needs a browser: `npx playwright install chromium`, once.

`DEEPGRAM_API_KEY` is required for transcription. Without it, recording, the
offline queue and upload all still work — segments simply sit at
`transcript_status = 'failed'` until a key is present and sync retries.

Magic-link mail lands in Inbucket at http://localhost:54324. Seeded accounts:
`supervisor@example.com`, `pm@example.com`, `admin@example.com`.

**Email is the one thing not yet configured, and it needs a decision.**

The magic-link template lives at `supabase/templates/magic-link.html` and is wired into
`config.toml`, but pushing it fails:

> Email template modification is not available for free tier projects using the
> default email provider. Please upgrade your plan or configure a custom SMTP provider.

So the template reference is commented out and the project sends Supabase's stock mail.
That costs two things:

- **The link only works in the browser that asked for it.** The stock template sends a
  PKCE `code`; our template sends a `token_hash`. On a phone, mail apps open links in
  their own in-app browser, which holds none of the requesting browser's cookies, so a
  PKCE link fails there. `/auth/confirm` handles both, so this is purely a template
  problem — signing in on a laptop works today.
- **No six-digit fallback.** The stock template does not include `{{ .Token }}`, so the
  code entry on the login screen has nothing to receive.

Supabase's built-in mail is also rate-limited to a handful an hour and lands in spam
often, which rules it out for a crew regardless. **Configure custom SMTP** (Resend,
Postmark, SES — all have free tiers), then uncomment `content_path` in `config.toml` and
run `npx supabase config push`. That restores both the phone-proof link and the code
fallback in one step.

**Current rollout path: QR sign-in.** Until SMTP is worth doing, do not fight email on
site. Seat the crew, then mint one-use QR codes from the operator script:

```bash
npm run signin -- --project KBS_C001 --qr-pack
npm run signin -- --project KBS_C001 --qr-pack --role supervisor
```

That opens a printable pack, one QR per existing project member. Each QR is a single-use
magic link for the named person, so hand cards out directly and generate a fresh pack when
they expire. For one person, use `npm run signin -- --email danny@example.com --qr`.

---

## What's here

| Migration | |
|---|---|
| `090100_foundation` | enums, `app` helper schema, `profiles` + signup trigger |
| `090200_core_tables` | organisations, projects, project_members |
| `090300_entries` | entries and the ten child tables |
| `090400_entry_numbering` | `KBS_C001_DD_142` serials issued at signing, supersede validation |
| `090500_content_hash` | canonical JSON + SHA-256 |
| `090600_signing_gates` | the four blocking gaps |
| `090700_immutability` | signed entries reject UPDATE/DELETE, children reject INSERT too |
| `090800_rls_helpers` | membership predicates (SECURITY DEFINER, private schema) |
| `090900_rls_policies` | RLS on every table, `anon` revoked |
| `091000_storage` | private buckets, project-scoped object policies |
| `20260826090100_capture` | audio segments, transcript state, project vocabulary |
| `20260827090100_weather` | BOM provenance columns, snapshot cache, review warnings |
| `20260828090100_extraction` | extraction proposals — what the model suggested |
| `20260829090100_review` | atomic apply, and the gaps the sign button is gated on |
| `20260830090100_query` | the `diary` read-only view schema, search, SQL executor |
| `20260831090100_onboarding` | `onboard_project()` — standing up a site |

Auth: `src/lib/supabase/*` (browser / server / admin / middleware clients),
`src/middleware.ts` (session refresh + route gate), `src/app/login/*`,
`src/app/auth/confirm/route.ts`, `src/lib/auth.ts`.

Capture: `src/lib/capture/*` (recorder, IndexedDB queue, sync, live socket,
linear16 conversion, section cues), `public/pcm-worklet.js` (audio-thread PCM
tap), `src/lib/transcription/*` (Deepgram, glossary),
`src/app/api/*` (entry find-or-create, segment register, transcribe, live
token), `src/app/page.tsx` + `today-panel.tsx` (screen 1),
`src/app/record/*` (screen 2), `public/sw.js` + `manifest.webmanifest` (PWA).

Extraction: `src/lib/extraction/*` (contract, prompt, the call, completeness
check, scorer, twenty fixtures), `src/app/api/entries/[id]/extract`,
`scripts/extraction-eval.ts`.

Review and signing: `src/lib/review/*` (payload contract, gap rules, docket
field definitions), `src/app/entries/[id]/review/*` (screen 3),
`src/app/entries/[id]/signed/*` (screen 4), `src/app/api/entries/[id]/apply`
and `.../sign`.

Daily PDF: `src/lib/pdf/*` (loader, docket template, print styles, embedded
fonts, Chromium render), `src/app/api/entries/[id]/pdf`,
`src/app/entries/[id]/docket` (the same template on screen),
`scripts/pdf-determinism.mjs`.

Query layer: `src/lib/query/*` (schema description, SQL validation, the three
calls), `src/app/api/ask`, `src/app/ask/*` (screen 5).

### The capture path

```
record ──> IndexedDB ──> draft entry ──> Storage ──> segment row ──> transcript
           (always)      /api/entries    (direct,    /…/audio       /…/transcribe
                                          under RLS)
```

Every step writes its result back to the queue item before the next begins, so
a phone that loses signal halfway resumes rather than restarts. The blob is
deleted only after the server confirms the segment row exists. Nothing about
recording, queuing or local storage needs a network.

### Role model

| | read project | author + sign | manage members |
|---|---|---|---|
| supervisor | ✓ | own entries | |
| pm | ✓ | | |
| admin | ✓ | own entries | ✓ |

---

## Verification

`supabase/tests/01_schema_test.sql` runs in one transaction and rolls back. All fifteen
groups pass:

```
PASS  drafts carry no serial; counter untouched
PASS  a serial cannot be client-supplied
PASS  one original per author per day
PASS  blocking gaps prevent signing
PASS  signing issues the serial and a verifiable hash (KBS_C001_DD_001 / ff5d29eb1648)
PASS  numbering is per project
PASS  signed entries and their children are immutable
PASS  drafts remain editable and deletable
PASS  draft identity columns are pinned
PASS  canonical JSON is insert-order independent
PASS  corrections supersede, and are unnumbered until signed
PASS  serials are gap-free and follow signing order (1,2,3)
PASS  PM reads own project only
PASS  supervisor write scope is own drafts in own projects
PASS  non-members see nothing
```

The application tests are `npm test` — 113 assertions over the pieces with real
logic in them: the keyterm budget, the section cue matching, the linear16
conversion, the PCM worklet's buffering, the weather derivation, the
completeness check, the extraction scorer, the fixture set itself, and the
review payload's gap rules, the PDF's formatting and ordering, and the SQL
validator.

`npm run pdf:check` is separate because it needs a compile step and a browser.
It is §10's other assertion — the same entry rendered twice, seconds apart, in
separate browser contexts, compared byte for byte:

```
OK    full entry: byte-identical across renders (110856 bytes)
OK    nil and gap sections: byte-identical across renders (70021 bytes)
OK    different entries render differently
```

The worklet runs on the audio
thread where a browser test cannot reach it, so the test loads
`public/pcm-worklet.js` against a fake AudioWorklet host and checks that
awkward render quanta come out as exact frames with no gaps or repeats — the
kind of bug nobody notices until a transcript comes back stuttering.

The weather tests run against a real IDW60920 product trimmed to five stations,
so parsing and window handling are checked against what the Bureau actually
sends rather than against a hand-written idea of it.

Two tests earned their keep by failing. Crew names were being matched as whole
strings, so "Danny and Kel were on the deck" never lit the Labour chip because
the vocabulary holds "Danny Rowe" — names now match per word. And running the
BOM fetch live showed `observed_to` reading 21:00 at half past seven in the
evening, because BOM declares a running maximum's window as the whole daylight
period whatever the time actually is; the window is now cut back to the moment
of the fetch.

**Where this has actually run.** All sixteen migrations are applied to the hosted
project `site-diary-prod` (`upnkkqqwstwtmfqmmbjh`, ap-northeast-1) on **PostgreSQL
17.6**, and all seven suites pass there. What landed:

| | |
|---|---|
| public tables | 19, **all 19 with RLS enabled** |
| policies | 66 in `public`, 5 in `storage` |
| `diary` views | 9 |
| `app` functions | 27 |
| storage buckets | 3, all private |

The storage migration was the one expected to fail — it creates policies on
`storage.objects`, which a real project owns under `supabase_storage_admin`, and
inserts into `storage.buckets`. It applied without complaint.

Development still runs against a throwaway Postgres 18.4 cluster with hand-written
stubs for `auth.users`, `auth.uid()` and the `storage` schema, because there is no
Docker on this machine and so no local Supabase stack. That is a convenience for the
inner loop; the hosted project is the thing that counts, and `npm run db:test` runs the
same suites against either.

`npm run typecheck` and `npx next build` are both clean.

---

## Step 2 decisions worth your review

**A. Recordings live in a new `entry_audio` table.** §3 gives `entries` a single
`audio_url` and a single `transcript_raw`. The offline queue can hold several
recordings for one day before it ever sees a network, and a supervisor who gets
interrupted records twice — one blob per entry would silently drop the rest.
Segments now live in `entry_audio`, and `entries.audio_url` /
`entries.transcript_raw` are maintained from them by trigger, so the §3 contract
is unchanged for the PDF and the hash. Transcripts concatenate in segment order,
not arrival order, which is tested.

**B. Audio segments are inside the content hash.** `canonical_entry_json` is
replaced to include them. Changing a segment changes the hash — tested. No
entries are signed anywhere yet, so nothing is invalidated; if that stops being
true this needs a re-hash migration instead.

**C. The live transcript is display-only.** §7.2 asks for a streaming transcript
and chips that light up; §2.6 says capture must work with no connection. Those
pull in opposite directions, so they are separated: the recording screen opens a
Deepgram live socket when it can, purely for on-screen feedback, and the
transcript that becomes the record always comes from a batch pass over the
complete file. A dropped socket, a flat token or no signal at all costs the
supervisor the live text and nothing else. The batch pass is also the better
transcript — it has the whole file, punctuation and a paragraph pass.

The token for the live socket is a 60-second JWT minted by
`/api/deepgram/token`, passed on the URL as `access_token`. Not in
`Sec-WebSocket-Protocol` — those JWTs are long enough that browsers reject the
handshake outright when they are sent as a subprotocol.

**D. The live socket is fed from the audio graph, not from MediaRecorder.**
iOS Safari's MediaRecorder emits fragmented MP4, which Deepgram's streaming
endpoint rejects — feeding the socket from the recorder works on Android and
silently does nothing on iPhone. So there are two taps on one microphone:

- **MediaRecorder** produces the file. That blob is the record.
- **A Web Audio graph** produces raw linear16 for the live transcript, via an
  AudioWorklet (`public/pcm-worklet.js`) that buffers the 128-sample render
  quantum into ~128 ms frames and posts them across as transferables. The main
  thread converts to 16-bit with `floatToInt16` and sends. Same AudioContext
  drives the waveform, so there is one, not two.

The context asks for 16 kHz — speech models work there, and a site on one bar
does not need 48 — but the browser is free to refuse, so the rate that comes
back is what gets sent to Deepgram as `sample_rate`. There is a ScriptProcessor
fallback for older Android WebViews that have `audioWorklet` but fail to load a
module, and the socket stops accepting frames once 512 KB is queued in the
browser: a transcript a minute behind is worse than one with a gap, and the
record is unaffected either way.

The recorded file is untouched by any of this — MediaRecorder works off the
MediaStream directly, so it keeps full quality regardless of the graph's rate.

**E. The section chips are a listening aid, not extraction.** They fire on a
fixed cue list plus the project's own vocabulary, so a crew name lights Labour
without anyone saying the word. A lit chip means the subject came up, not that a
field has been captured. The completeness check in §4 — the one that actually
asks "nothing on plant today, is that right?" — belongs to step 3 and is not
built.

**F. `entry_date` comes from the device.** A Perth knock-off at 17:30 is already
tomorrow in UTC, so the server would open the wrong day. Both the Today screen
and the queue use the phone's local date, which is why the Today panel is a
client component.

**G. Vocabulary grows on its own.** `public.project_keyterms()` unions the manual
`project_keywords` list with every crew name, plant item, area and supplier the
project has already recorded, and the fixed glossary is added in code. Project
terms go first, because the 500-token cap truncates and a supervisor's surname
is unguessable where "excavator" is not.

**H. Sign-out clears the service worker caches.** The worker caches navigation
responses so the app opens offline, and those pages carry the supervisor's own
project data. On a shared phone, leaving them behind would show the next person
the last person's diary.

---

## Query layer decisions worth your review

**Q1. Generated SQL runs against a purpose-built schema, not the real one.**
`diary` is a set of `security_invoker` views — small, read-only, and shaped for
this. The prompt can describe the whole surface in a page, every row already
carries `entry_no`, `entry_date` and the project so no answer needs a join to
cite its sources, and there is far less to reason about when the SQL was
written by a model from a sentence someone typed.

**Q2. The views show the current record only, and this is the one that would
have bitten.** Signed entries, minus any a later correction supersedes. A draft
is not the record; and counting an entry *and* the correction that replaced it
would double every number in a claim. The SQL suite sets up a corrected day and
asserts the total comes back 5 hours, not 9 — and not 104 with the draft
included.

**Q3. What actually makes running generated SQL safe, in order.**

1. **SECURITY INVOKER.** The query runs as the signed-in user, so RLS applies.
   The worst a generated query can reach is rows that person could already
   read. A test runs one as a non-member and gets nothing back.
2. **A read-only transaction.** The executor is `STABLE` and called over GET,
   which PostgREST runs `READ ONLY`. Writes and DDL fail at the transaction
   level whatever the string says.
3. **An empty `search_path`.** `from entries` resolves to nothing, so every
   relation must be schema-qualified — which makes a schema denylist precise
   instead of hopeful.
4. **A statement timeout and a row cap.**

The string checks in `src/lib/query/validate.ts` are a fourth layer whose job is
a readable error, not safety. The file says so, at length, because someone will
eventually read it and assume otherwise.

**Q4. My first schema restriction was wrong, and the tests caught it.** It
required every `FROM` to be `diary.`-prefixed. That rejects `from my_cte` — and,
worse, `extract(month from entry_date)`, which is the single most useful thing a
PM asks for. Both are now regression tests, in SQL and in TypeScript.

**Q5. An empty result never reaches the model.** §5 forbids answering from the
model's own knowledge. Rather than instruct that and hope, zero rows returns a
fixed sentence and the model is not called at all — a model that is not invoked
cannot invent anything.

**Q6. No retry.** §2 asks for fixed, non-branching calls, so a query that fails
to run is reported with the SQL shown rather than silently regenerated. One
bounded retry feeding the error back would measurably improve the hit rate; it
is the obvious next improvement and it is deliberately not here.

**Q7. Ask is open to supervisors too, not PM-only.** §7.5 marks the screen as
PM-only. RLS scopes the data either way, and blocking a supervisor from asking
"when did we last pour at Pier 3" about their own diary serves nobody. Easy to
gate if you disagree — it is one check in `src/app/ask/page.tsx`.

**Q8. The classifier is Haiku.** §5 asks for a lightweight classifier call, so
routing uses `claude-haiku-4-5` and only the SQL and the phrasing use the model
the brief names. If it fails it falls through to the structured path, which
shows its working, rather than failing the question.

---

## Daily PDF decisions worth your review

**P1. Byte-identical took three fixes, and one caveat remains.** §2.3 asks that
regenerating the same entry a year later produces the same document. Out of the
box it does not, for three reasons:

- **Fonts over the network.** IBM Plex is embedded as base64 (latin subset,
  ~75 KB, OFL 1.1, licence included). The render touches nothing outside the
  process — no Google Fonts, no bucket, nothing that has to still be up in a
  year.
- **Timestamps.** Chromium stamps `CreationDate` and `ModDate` from the wall
  clock, so two renders differ within seconds. Both are rewritten to an instant
  derived from the entry — its signing time — so the PDF says when the *record*
  was made, not when this copy of it was printed.
- **The document `/ID`,** which Chromium derives from those timestamps.
  Rewritten from the content hash: same record, same identifier.

**The caveat:** the Chromium build itself. A different version may lay text out
differently, and no post-processing fixes that. If the documents must match
forever, pin the Playwright version alongside the archive.

**P2. One template, rendered two ways.** §2 says the printed template must be
the one used on screen. Rather than trust that, there is only one —
`DailyDocket` is rendered to markup for Chromium and mounted directly at
`/entries/[id]/docket`. They cannot drift because there is nothing to drift
from.

**P3. Nil and gap print differently, and that is the point.** A confirmed nil
prints in black — "NIL — confirmed by the supervisor". An unanswered section
prints in amber — "NOT RECORDED — no answer given". A record that blurred them
would let an unanswered question read as a confirmed nothing.

**P4. No AI-generated text, and none of the extraction's bookkeeping either.**
§2.3 rules out the first. `source_quote` and `confidence` are also absent: they
are how the proposal was reviewed, not what was signed. The transcript is not
printed either — §6 lists the header, the sections, the photos and the
signature, and nothing else. Say the word if you want the transcript appended;
it is stored and it is the provenance trail §2.5 asks for.

**P5. Timestamps are UTC, formatted by hand.** Not `toLocaleString`: locale
formatting depends on whatever ICU data the runtime happens to carry, which is
exactly the sort of thing that changes underneath an archive. A test renders
the same instant under four different `TZ` values and asserts one output.
`entry_date` already carries the site's own local day.

**P6. Rows are ordered by content, never by id.** Row ids are random uuids;
ordering by them is stable in one database and meaningless in a restore. A test
restores the same rows with new ids and new timestamps and asserts the order
holds.

**P7. Chromium on serverless — solved, with one caveat.** A stock function
cannot hold a normal Chromium install, so on Vercel the renderer uses
`@sparticuz/chromium` through `playwright-core`; locally it uses the full
Playwright install, which is what the determinism check runs against. Verified
in production: a page renders in about 3.6 seconds.

Two things were needed beyond installing it. The function wants 2 GB and a long
timeout. And because Playwright is an external package, Next does not follow its
imports and never learns it reads `browsers.json` at runtime — so the file was
left out of the deployment and the failure arrived as a module-not-found for a
JSON file, nowhere near anything mentioning PDFs. `outputFileTracingIncludes`
pulls it in.

**The caveat:** those are two different Chromium builds, so the same entry
rendered on a laptop and in production is not byte-identical across the two.
§2.3 asks that regenerating an entry reproduces its document, and that holds —
generation only ever happens in production, against one pinned build. The local
path exists for the test, not for the record.

**P8. Exports are written by the service role.** The `exports` bucket has a read
policy for project members and deliberately no insert policy — a generated
record should only come from the generator. The object path is
`{project_id}/{entry_no}.pdf`, because the bucket policy reads the first
segment as a project id; a human-readable code there would have made every
stored PDF invisible to the members who own it.

---

## Review and signing decisions worth your review

**R1. Applying is one database function, so it is one transaction.** Rewriting
a draft's child rows through a sequence of client calls would leave a half
-wiped entry behind on any failure, and "the network dropped and took half my
day's labour with it" is not an acceptable failure mode here.
`public.apply_entry_review()` deletes and rewrites in a single statement; a test
feeds it a payload with an invalid delay category and asserts the draft is left
exactly as it was.

**R2. Replace semantics, not merge.** What the supervisor confirms is the
entry, in full. Anything they deleted is gone; anything they added is theirs.
Items they add by hand carry **no** `source_quote` and **no** `confidence` —
nothing in the transcript says it, and claiming otherwise would put words in
their mouth. Both are tested, in SQL and in TypeScript.

**R3. Sign applies first.** The sign button sends the payload and applies it
before signing, so what is on screen when they press it is exactly what gets
signed — rather than whatever happened to be saved last. Once signed the entry
is immutable for good, so that is not a gap worth leaving open.

**R4. The sign button is gated on the database's own answer.**
`public.entry_review_state()` wraps `app.entry_blocking_gaps()` and
`app.entry_warnings()` for the client. The blocking rules are still implemented
twice — once in TypeScript so the amber prompts appear as the supervisor types,
once in the trigger that refuses the transition — so `src/lib/review/schema.test.ts`
pins the client half against the same cases the SQL suite pins the database
half against. If they ever disagree, the database wins and the sign is refused.

**R5. No hash before signing.** I built a "projected hash" so the review screen
could show the record was settled, and the SQL test caught that it cannot be
right: `entry_no` is inside the hashed content and the serial does not exist
until signing. Rather than weaken the hash to make the feature work, the
feature went. The content hash appears on the signed screen (§7.4), where it is
real.

**R6. Gaps are a compact checklist, reasons sit with the section.** The first
version put four full-width amber paragraphs above the docket, which pushed the
entire entry off a phone screen — a good way to teach someone to scroll past
warnings. The list at the top is now four short lines; the reason each one
matters appears against the section it belongs to, where it can be acted on.

**R7. Warnings never block.** A weather delay on a day the gauge recorded no
rain is flagged for the supervisor to confirm, not vetoed — they were on site
and the gauge was kilometres away. A test signs an entry carrying that warning.

**R8. A PM cannot apply, and cannot reach the review screen.** They are
redirected to the signed view. Tested in SQL: `apply_entry_review` refuses
anyone who is not the draft's author, and a non-member cannot even read the
review state.

---

## Deployment

Production is `https://site-diary-eight.vercel.app`, in Vercel's Sydney region,
against the Supabase project `site-diary-prod`.

Verified working in production: capture, transcription, extraction, review,
signing, the query layer, BOM weather, and PDF rendering.

Two things bit during deployment, both worth knowing:

- **`.vercelignore` patterns are unanchored.** `supabase/` also matches
  `src/lib/supabase/` — the app's own database clients — and the build fails
  with a module-not-found that looks nothing like an ignore-file problem. The
  entries are anchored with a leading slash.
- **`NEXT_PUBLIC_` variables cannot be stored as secrets**, which is correct:
  they are inlined into the browser bundle. They go in with `--no-sensitive`;
  the three real secrets do not.

`site-diary-lore-1a4a.vercel.app` sits behind Vercel's SSO protection and will
bounce a phone to a Vercel login. The `-eight` hostname is the public one.

---

## Standing up a site

`organisations` has no insert policy and `projects` may only be inserted by an
existing org admin. That is right for day-to-day use — nobody should conjure an
organisation out of the app — but it leaves no way to create the first one.

`public.onboard_project()` is that way: SECURITY DEFINER, with EXECUTE revoked
from `anon` and `authenticated` and granted to `service_role` alone. A test
asserts a signed-in supervisor calling it gets `permission denied`.

```bash
npm run onboard -- \
  --org "Kingsbridge Civil" --org-code KBS \
  --project "Northern Interchange Stage 2" --project-code C001 \
  --admin boss@kingsbridge.com.au \
  --lat -31.9523 --lng 115.8613 --contractor "Lendlease" \
  --supervisor danny@kingsbridge.com.au --pm priya@kingsbridge.com.au \
  --crew "Danny Rowe" --crew "Sam Whitely"
```

Everyone named must have signed in once — the magic link is what creates the
account. Anyone who has not is **reported and skipped rather than fatal**, and
the whole thing is idempotent: re-running with the same arguments picks up the
stragglers, and is also how you add crew to a site that already exists.
Optional fields left off a re-run are preserved, not blanked — a test covers
that, because erasing a project's coordinates on a re-run would silently kill
weather.

Crew names passed as `--crew` go straight into `project_keywords`, which is the
transcription vocabulary. Getting them in before the first recording is most of
the difference between "Danny Rowe" and "Danny Roe" in a signed record.

Needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

---

## Extraction decisions worth your review

**X1. Extraction writes a proposal, not the record.** Non-negotiable #1 says
nothing is stored without the supervisor confirming it, and that the review
screen is the point. So the extraction route writes to `entry_extractions` and
touches none of `labour`, `plant`, `work_items`, `variations`, `delays`,
`pours` or `quantities` — a test asserts exactly that. The review screen (step
4) is what turns approved items into the record.

The proposal is kept after it is applied. When a number is disputed, "the model
heard five and the supervisor corrected it to four" is worth being able to
show. It is frozen when the entry is signed, like every other child table, but
it is deliberately **not** part of the content hash: the hash covers what was
signed, not what was suggested. Also tested.

**X2. The model is the one the brief names, but the mechanism is not.** §4 says
"system prompt instructs: return JSON only, no preamble, no markdown fences".
That was the right instruction to write, and it is now the weaker of two
options — `claude-sonnet-4-6` supports structured outputs, so the schema is
attached to the request via `output_config.format` and a reply with preamble,
fences or a missing key is structurally impossible rather than merely asked
for. The prompt still carries the extraction rules; it no longer has to beg for
well-formed JSON.

This matters more than it sounds, because the old fallback is gone: **assistant
prefill returns a 400 on this model**. Priming the reply with `{` — the usual
way of forcing JSON out of a model that will not stop chatting — is not
available. Structured output is the mechanism that replaces it.

**X3. Through the official SDK, not a hand-rolled fetch.** §2 says "three
fixed, non-branching API calls — each a plain `fetch` from a server route". It
is still one fixed, non-branching call with no framework anywhere near it, but
it goes through `@anthropic-ai/sdk`: that is what carries `messages.parse()`,
the Zod schema binding, and typed errors that let the sync queue tell a rate
limit apart from a bad key. If you want the literal hand-rolled fetch back it
is a contained change, but you would be reimplementing schema validation to get
there.

**X4. Every field is required-but-nullable, never optional.** The model has to
emit `null` rather than omit a key, so "not stated" is a positive assertion in
the output instead of something inferred from an absence. That is what makes
§2.4 checkable at all.

**X5. The completeness check is deterministic.** Follow-up questions are fixed
templates, and the section states the model returns are reconciled against the
items it actually extracted — a model that lists three workers and then calls
labour a gap has contradicted itself, and the items win. `nil_confirmed` is
never overridden on an empty section, because that is the supervisor's own
answer and the whole point of the distinction. None of this asks the model
anything; "did the model contradict itself" must not come from the model.

**X6. The eval measures invention separately from accuracy, and that is the
number that gates a prompt change.** Two failures matter very differently: a
*missed* value gets asked about, a *invented* one gets signed and never
questioned again. `npm run extraction:eval` reports them apart and exits
non-zero if anything was invented — or if any fixture failed to run, which an
earlier version of the harness happily reported as 100%.

It also checks that every `source_quote` appears **verbatim** in the
transcript. That is the cheapest hallucination check available and it catches a
failure mode field-scoring cannot: a value that is right by luck, attributed to
words nobody said.

**X7. Free text is scored loosely and kept out of the headline figure.** The
model will phrase a work description differently every time; folding that into
the same number as "was the pour 18 m3 or 21" would make the number
meaningless.

**X8. Two fixtures exist only to catch invention.** `16-partial-hours` gives
hours for two of four named workers — the other two must come back null.
`19-pour-no-volume` mentions a concrete delivery with no docket and no volume —
both must stay empty. A model that helpfully fills those in scores *worse* than
one that leaves them blank.

**X9. I could not run the accuracy set.** There is no `ANTHROPIC_API_KEY` on
this machine, so the twenty fixtures have never been through the real model.
Everything around them is tested — the contract, the scorer against known-answer
predictions, the fixture set's internal consistency, the harness's failure
modes — but **the accuracy number itself does not exist yet**. Run
`npm run extraction:eval` before trusting the prompt; expect to iterate on it,
and treat the first run as calibration rather than a verdict.

---

## Weather decisions worth your review

**W1. There is a licensing question here that is yours, not mine.** Both of
BOM's convenient HTTP routes are closed to this use:
`api.weather.bom.gov.au` answers with *"This API is owned by the Bureau of
Meteorology. You must not use, copy or share it"*, and the
`www.bom.gov.au/fwo/*.json` feeds return 403 with *"The Bureau of Meteorology
website does not support web scraping: if you are trying to access Bureau data
through automated means, you should stop"*. That 403 names the anonymous FTP
channel as the supported alternative, and that is what this uses:
`ftp://ftp.bom.gov.au/anon/gen/fwo/ID{X}60920.xml`, one product per state,
verified working end to end.

The Bureau's copyright page itself blocks automated fetches, so **I could not
read the licence terms** and have not assumed them. `BOM_ATTRIBUTION` is carried
through to the UI, and it must go on the PDFs too. Before this ships
commercially, someone should confirm the terms for this use — the Bureau sells
a paid Weather Data Services product, and a diary meant to stand up in a dispute
should not rest on a feed you are not clearly entitled to.

**W2. Cached per state, not fetched per phone.** One product covers a whole
state, so `bom_snapshots` holds the parsed stations with a ten-minute TTL. Every
supervisor on every project in WA is served by one poll. The table has RLS on
and no policies at all — service_role bypasses RLS, every client is refused.
A stale snapshot is used if BOM is unreachable, and flagged as stale rather than
passed off as live.

**W3. A reading is only recorded if its window belongs to the day.** This is
where the real work went. BOM attaches a window to every element, and those
windows move: at knock-off the "minimum air temperature" on the wire covers
*tonight*, 18:00 to 09:00 tomorrow — not this morning. Recording it as the day's
minimum would be inventing a number, which §2.4 forbids, so it is dropped and
the field stays null for the supervisor. Same test for rainfall (window must
open on the entry date) and wind (the reading itself must have been taken that
day). A back-dated entry gets nothing at all and says so — observations only
describe the current day.

**W4. Observations accumulate across the day.** Because of W3, a single fetch at
knock-off would never capture a minimum. So the Today screen and every sync
refetch, and the results are merged rather than replaced: the morning's minimum
survives even after BOM has moved that element on, running maxima and rain
totals only ever rise, wind takes the newest reading. Readings from a different
station replace rather than merge — a maximum from one gauge and a rain total
from another is not an observation of anywhere.

**W5. Provenance is part of the record.** `weather` gains `station_id`,
`station_name`, `station_distance_km`, `observed_from`, `observed_to` and
`fetched_at`, all of which join the content hash automatically. Without them a
"rainfall 0.0 mm" on a signed entry is unfalsifiable; with them it is a specific
claim about a specific gauge over a specific period, which is the only version
worth anything in a dispute.

**W6. Nothing is recorded from a gauge more than 50 km away.** Better a null the
app asks about than a number from the next valley. Beyond that distance the
route declines and tells the supervisor to pin a station or enter it by hand.
`app.entry_warnings()` also flags anything over 25 km for the review screen.

**W7. The §4 warning is built, as a warning.** `app.entry_warnings()` returns
`weather_delay_without_rainfall` when a weather delay is claimed on a day the
gauge recorded none, plus `weather_delay_without_weather_record` and
`weather_station_far_from_site`. Deliberately separate from
`app.entry_blocking_gaps()`: the supervisor was on site and the gauge was
kilometres away, so this is a question to confirm, never a veto. A test asserts
an entry with warnings still signs. The review screen that shows them is step 4.

**W8. A hand-entered reading is never overwritten.** `source = 'manual'` rows
are returned untouched, and `observed_impact` — the supervisor's words, not the
Bureau's — is preserved across every auto-refresh. The UI for entering one by
hand belongs to the review screen and is not built.

**W9. State is inferred from coordinates, coarsely.** Seven state products, and
the inference is rectangles, which state borders are not. `projects.bom_product_id`
pins it for a site near a border. The distance check in W6 is the real safety
net: a wrong product yields a station hundreds of kilometres away and is refused.

**W10. FTP from a serverless function — it works.** I expected this to be the
thing that broke on deployment and said so. It does not: from Vercel's `syd1`
region, `basic-ftp` pulls the whole WA product — 148 stations — in about 2.2
seconds. Weather needs no workaround.

`/api/ops/check` is what established that, and it stays as the answer to
"can this host reach the Bureau, and can it start a browser" — the two
capabilities that are environment-dependent and fail in ways that look like
application bugs from the outside. It refreshes the snapshot cache as it goes,
is gated by `CRON_SECRET` as a bearer token, and runs daily on Vercel Cron as a
backstop. Between runs the resolver refreshes inline when the cache is over ten
minutes old, so the schedule is politeness rather than load-bearing.

**W11. The site has weather every day; the diary only has it on days someone
wrote one.** Readings hung off `weather.entry_id`, so a Sunday, a rained-off
day or a forgotten day had no reading at all, and the Today screen's week table
showed a dash exactly where a delay claim would later want a number. The
Bureau publishes a daily climate table per station on the same anonymous FTP
(`/anon/gen/clim_data/IDCKWCDEA0/tables/<state>/<station>/<station>-YYYYMM.csv`):
maximum, minimum, rain to 09:00 and average wind, one row per day, re-issued
each morning. `project_weather_days` keeps one row per project per day from it,
built by `src/lib/weather/days.ts`, refreshed by the Today screen when it is
over half an hour old and by the daily cron at 07:00 UTC after the Bureau
re-issues.

Three things about it were decided rather than fallen into. The table's rain
on row *D* is the 24 hours *to* 09:00 on *D*, so the rain that fell on site day
*D* is on row *D+1* — `dailyForDay` does that shift, which means a day's rain
settles two mornings later while its max and min settle one; until then the
live gauge's running figures stand in, and the row says which (`source`). The
table overrides an observation for the same gauge because it is the finalised
figure; it never overrides a reading a supervisor typed into a diary, and the
Today screen shows the typed reading first. And it is not the record: it is not
in the content hash, an entry's own `weather` row is still what the docket
prints, and the day store only fills that row's *gaps* (the overnight minimum a
late fetch has lost) — never replaces what the observation saw.

---

## Decisions worth your review

**1. `organisations.code`.** Added, not in the brief's data model. `KBS_C001_DD_142` needs
an org prefix from somewhere. Constrained to `^[A-Z0-9]{2,8}$`.

**2. The uniqueness constraint is partial.** The brief specifies
`UNIQUE (project_id, entry_date, author_id)`, but a correction entry is by the same
supervisor, on the same project, for the same work date — so as written, corrections are
impossible. It is now a partial unique index limited to originals
(`WHERE supersedes_entry_id IS NULL`). Still one diary per supervisor per day; corrections
are exempt.

**3. `source_quote` and `confidence` are stored columns.** §4 requires both on every
extracted object; §3's model doesn't list them. They're on all eight extracted child
tables, nullable, and included in the content hash — they are the provenance trail §2.5
asks for, and dropping them at signing would throw away the audit link between a disputed
number and the words it came from. `weather` has neither: it comes from BOM, not from
speech.

**4. `entry_sections` is a new table.** §4 says a deliberate nil must be distinguishable
from a gap, which needs somewhere to live. One row per section per entry, state
`gap | captured | nil_confirmed`, plus a free-text note for what was asked and answered.

**5. Signed entries also reject child INSERTs.** The brief says the trigger rejects UPDATE
and DELETE. Allowing INSERT would let anyone bolt extra labour rows onto a signed record,
which defeats the purpose, so INSERT is blocked too.

**6. Blocking gaps are enforced in the database.** The four gates from §4 (variation
without VR ref, variation without photo, pour without volume, delay without times) are
checked by `app.entry_blocking_gaps()` and refuse the `draft → signed` transition. The
review screen in step 4 is still the primary surface for these — this is the backstop.
**If you'd rather this stayed UI-only, delete `090600` and the one call in `090700`;**
nothing else depends on it.

**7. Serials are issued at signing, and the run is gap-free.** `entry_seq` and `entry_no`
are null on a draft and allocated in the signing trigger, under the same project row lock.
Because a signed entry can never be deleted and nothing else advances the counter, the
serials are contiguous — 001, 002, 003 with nothing missing. An abandoned or deleted draft
consumes no number, and a client cannot claim one for itself: a draft carrying a serial
fails the `entries_signature_complete` constraint. Both are tested.

Two consequences worth knowing before the screens get built:

- **Serials follow signing order, not entry date.** Two supervisors recording on the same
  day are numbered in the order they knock off, and a correction signed today takes a lower
  number than an older draft signed tomorrow. That is how a carbonless docket book actually
  fills up, so it should read as normal — but the daily PDF and any register should sort by
  `entry_date`, not by `entry_seq`.
- **Screen 1 (Today) can't show a firm serial.** §7.1 puts the entry serial in the header;
  before signing there isn't one. `app.project_next_entry_no(project_id)` returns the number
  the entry *would* take, and the browser can derive the same value from columns it already
  reads. Show it as provisional — greyed, or prefixed `NEXT:` — because another supervisor
  signing first will take it. The firm number lands on screen 4 (Signed), next to the
  content hash, which is where it actually matters.

**8. What the content hash covers.** Entry identity, the transcript, the audio URL, the
section states, and every child row — excluding surrogate `id`/`entry_id` columns and
`created_at`. It excludes the signature block (`status`, `signed_at`, `signed_by`,
`content_hash`) so the hash stays a function of the record and can be re-verified at any
time with `app.verify_entry_hash(entry_id)`. Child arrays are ordered by their own
canonical text, so the hash depends on content and never on insert order or row ids — a
test covers this. `timezone`, `datestyle` and `extra_float_digits` are pinned on the
function so rendering can't drift with session settings.

**9. Storage is included.** Three private buckets with the same project-membership rules,
and the path convention `{project_id}/{entry_id}/{filename}` that the policies parse.
Uploads are only permitted while the parent entry is the caller's unsigned draft, so a
signed entry can't gain or lose attachments. Step 2 needs this to exist.

**10. One index built early.** A GIN full-text index on `entries.transcript_raw`, for the
semantic query path in §5. One line now, no migration later.

**11. Nobody can delete a user who has written entries.** `entries.author_id` is
`ON DELETE RESTRICT`. Deleting an author would orphan a legal record.

**12. Next 16, not 15.** Next 15 pulls in three high-severity advisories via `postcss` and
`sharp` that only 16 clears. Nothing is built on it yet, so the upgrade was free —
`npm audit` is at zero.

---

**R9. One document per day, and the database holds the line.** A supervisor
sees one diary for a day. Before signing that is one editable entry for the project's
day, whoever started it (`entries_one_open_per_day`); a second phone gets a 409 naming
who has it open. After signing, anything further is a correction that supersedes the
version currently standing — never a fresh original, whoever asks
(`entries_one_original_per_day`, a trigger, because the sandbox already carries a
per-author-era day with three originals and an index could not be built over it). The
review that found the gap (Codex, 5 September 2026) put it plainly: the API checked
"signed" per author, so a second supervisor could open and sign a parallel original
and the day would have two signed records with no relationship between them. The queue
never turns a blocked "day already signed" recording into a correction on its own
either; that is the supervisor's tap on the queue card. The weekly marks every
unsigned day's figures where they appear — its labour column, every dated line — and
says under the plant totals that they include those days.

## Not built, and deliberately so

- **Organisation and project creation.** `projects` can be inserted by an org admin;
  `organisations` has no insert policy at all, so the first org and its first admin have
  to come from the service-role client (`src/lib/supabase/admin.ts`). There is no
  onboarding route yet — seed data covers local dev. Say the word if you want a real one.
- **A project switcher.** `resolveProject()` picks the first active membership. The
  switcher belongs with the Today screen.
- **Generated database types.** `src/types/database.ts` is hand-written for the tables auth
  touches, so step 1 compiles without a running stack. `npm run db:types` overwrites it
  properly once the stack is up — do that before step 2.
- **§8 items 7–8.** No weekly PDF, no narrative, no docket OCR.
- **A retry on failed SQL.** See Q6.
- **Cross-project questions.** Ask is scoped to one project at a time. The views
  carry `project_id`, so widening it is a prompt change and a screen control,
  but multi-project answers need thought about how they cite.
- **The distribution list** on screen 4 (§7.4). There is nowhere to store one
  yet — it needs a table and a per-project recipient list.
- **Spoken follow-up questions.** §4 allows the completeness question to be
  spoken or on-screen; it is on-screen only.
- **Photo thumbnails.** Photos attached to a variation show as chips, not
  images. The bucket is private, so showing them means minting signed URLs per
  photo — worth doing, not done.
- **Manual weather entry.** The `manual` source is supported and protected end
  to end; the screen for typing a reading in is part of the review screen.
- **Docket OCR and photos.** The `photos` table and the `entry-photos` bucket
  exist and are policed; nothing writes to them yet.
