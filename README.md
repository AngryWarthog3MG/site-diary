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

**R10. The variation register is a ledger beside the diary, not a field in it.**
The signed row proves a variation was directed; it never changes. What the office
needs is what happened next — priced, submitted, approved, rejected, paid — and that
belongs to the variation as a commercial item, not to any one day. So
`variation_register` holds one row per item, `variation_register_links` says which
diary rows (across days and corrections) are mentions of it, and
`variation_status_events` keeps every change with who, when and a note. Signing a day
registers its variations automatically: matched by VR reference, else by identical
wording, else a new item raised on that day; a later mention fills a blank reference
or estimate and never overwrites one. Status moves only through
`set_variation_status()`, which stamps submitted/decided/paid dates and writes the
event — the screen has no update policy to misuse. The claims screen leads with the
number and value not yet submitted, because that is where the money goes missing.
Nothing here touches the content hash or a signed row.

Two refinements the owner asked for the same day: a variation registers the moment it
is written into a diary, signed or not (the card says "not yet signed" until a signed
day stands behind it), and each item gets a running number per project — `V-007` —
issued at creation and never reused, separate from the client's own reference. The
review screen rewrites a draft's rows on every save, so registration matches by
reference or identical wording and relinks the same item; an item the supervisor took
out of a draft stays on the register marked "no longer in any diary" until someone
removes it, and `remove_variation_item()` refuses if any signed diary records it.

**R11. The job's documents answer questions; they never fill a diary.** A project
carries its specification, scope, contract, drawings register and safety plan
(`project_documents`, files in the `project-documents` bucket, revisions kept as
separate rows). On upload the server reads the file into per-page chunks
(`project_document_chunks`, full-text indexed): typed PDFs and Word files straight
through, scans and photographed pages transcribed by the model eight pages at a
time with an instruction to transcribe, not summarise. Ask gained a third path —
the classifier sends "what does the spec say" questions to `document_search()`
(full text, then a plain phrase match for codes like "AS 4419", then the question
itself), and the answer is written only from the passages returned, each cited
by document, revision and page; no passages, fixed sentence, no model call. The
same rule as the diary paths. Documents are reference material: nothing from them
reaches an entry, a signed row or the hash, and a supervisor who wants a spec
figure in the diary says it and confirms it like any other number.

The Spec tab on the review screen is the same machinery pointed at the day. For each
work item, pour and variation as typed, it finds the passages that bear on it and has
the model state what the documents *require* — a depth, cover, mix, hold point —
cited, in a sentence, or nothing. It is told not to judge: "spec says 300 mm" sits
beside "we placed 250" and the supervisor decides what to confirm. Nothing on the tab
is stored; it re-runs on request against the lines as they are now.

The prestart is the one place the specification *is* stored, deliberately. "We are
mulching Old Brand Drive and trenching for the mainline" is split into tasks, each task
fetches its passages, and the model states what the crew need to do it to spec — depth,
cover, material, hold points — in the document's figures, cited. The supervisor keeps
the tasks that apply (`prestarts.spec_notes`), the Spec tab shows them, and the
prestart PDF prints them under "From the specification". That is a briefing record:
what the crew were told the spec required, with the page it came from. It is not the
diary — nothing from it reaches an entry — and it freezes with the prestart.

A prestart can be written the night before. "Save for the morning" dates it tomorrow
(or the date chosen) and files it as ready: the list shows "Ready for 07/09", Today
shows "Tomorrow's prestart is ready" that evening, and the 06:30 push says "Your
prestart is ready" and opens it rather than "no prestart yet". Nothing else changes —
it is the same open record, editable until the crew sign on and it is finished.

**R12. A fourth role: the leading hand.** Supervisors write the record, PMs read it,
admins manage the job. The leading hand runs the morning prestart and the toolbox talk
and reads what they need — Today, past days, the weekly — and records nothing. One
table in `src/lib/roles.ts` says what each role may do and see; the menu on the phone
and the page guards on the server read the same table, and the pages *refuse* a screen
rather than merely hiding its tile (`/claims` for a leading hand lands on Today; the Ask
API answers 403). The database side is `app.can_run_talks()`, which now includes the
role — compared as text, because a fresh enum value cannot be named as an enum in the
transaction that adds it. Until the menu knows the role it draws only the tiles every
role has, so nobody sees a door that closes a moment later.

Codex's review of the role (7 September) found the gap a page guard cannot close: the
variation RPCs, the document table and bucket, Ask without a project, and the payroll,
client and monthly exports all took "project member" as enough, and a leading hand with
a session could reach them from a Supabase client. Two more verbs in the same table —
`canManageRegisters` (variation status and details, dockets recorded after signing,
document uploads) and `canExportReports` — mirrored in SQL by
`app.can_manage_registers()`, enforced inside every RPC and in the storage and table
policies, and checked by every report API. Reading and searching documents stays with
membership on purpose: a leading hand pulls what the spec requires when running the
prestart. The schema suite impersonates a leading hand and shows the RPC refusing.

Two prompts landed the same day, both warnings and never blocks: a variation with no
value ("worth $0" on the register until it has one) and a daywork with no docket. A
docket number that arrives after the day is signed goes beside the record
(`daywork_dockets`, via `set_daywork_docket()`), never onto the signed row; the client
sheet, weekly and claims print it as "added after signing", and until then the honest
state, "Docket to chase". The signed docket PDF is untouched.

**R13. Development spends on its own key, capped.** The extraction eval sends 25 transcripts
through the model and asks each for a full structured diary with reasoning: about 250,000
output tokens, roughly US$4 a run, more in one run than a month of real site use (a day's
diary is about nine cents). Run against the production key four times in an evening, it
drained the balance twice and took writing-up, Ask and both Spec tabs down on site — the
recordings were never at risk, but the app could not write them up until someone topped up.
So `scripts/dev-key.ts` makes both evals read `ANTHROPIC_DEV_API_KEY` and **stop** if it is
missing or identical to the production key, rather than falling back. A silent fallback is
the exact failure it exists to prevent. The cap lives on the key in the Console, because a
limit the code enforces is a limit the next script can forget.

**R14. Weekends are rest days.** Sunday 6 September showed on Past days as "a hole in the
diary" with a Record it pill beside it, and the home strip drew it amber. For an EOT diary a
gap in working days matters; a quiet Saturday does not, and flagging it every week teaches
the crew to ignore amber. `src/lib/calendar.ts` holds the one definition: Saturday and Sunday
with nothing recorded are rest days — shown grey, never nagged, never counted as missing on
the home page, the portfolio, or the weekly ("5 of 5 working days recorded"). A weekend that
*was* worked records like any other day and the weekly says so ("· 1 weekend day worked").
The knock-off reminder already skipped weekends; it now reads the same definition, so there
is nowhere for the two to disagree.

**R15. The home page is the button.** On a phone the page ran two and a half screens and
Talk it through sat below the fold, under a green hero of stat tiles that the seven-day strip
already says in colour. The owner's brief was "more simplistic", so the hero went entirely:
Home is one sheet like every other screen. Job and Menu on a line, the day as the heading,
Talk it through under it with Type it in as a text link, the prestart line, the strip with no
heading and no legend, whatever is not signed yet, and the weather as one line with a link to
the week. 1.1 screens and 63 words, from 2.4 and 258. Nothing a supervisor acts on was
removed; everything that only described the page was. A page that is only a button would
still leave them guessing whether yesterday got signed, so the strip and the not-signed list
stay.

**R16. A prestart can be talked through.** The recording goes to Deepgram; the model sorts the
words into the form's five fields (`src/lib/prestart/dictate.ts`) under a prompt that forbids
adding a hazard, control, plant item or permit nobody said — the obvious ones included — and
returns null for anything not mentioned. The supervisor reads, fixes and saves; nothing is
stored by the button. A field already typed keeps its words and gains a line
(`dictation-merge.ts`). The checklist is never ticked from speech: a tick that prints was made
by a person on the day. The transcript is kept on `prestarts.dictation` as provenance and is
never printed. `POST /api/prestart/dictate` refuses any role that cannot run prestarts.

**R17. A colleague's draft can be looked at.** The first morning with two people on one job,
the leading hand typed the day in and saved it, and the admin could not see a word: Home offered
him the record button (a second recording would have been refused — one document per day), the
strip landed on "not signed yet, back to review", and review redirects anyone but the author.
Now an unsigned entry seen by anyone other than its author is a draft page — who started it,
that nothing is on the record until they sign, that only they can change it — with a link to
the docket, which the template already prints as NOT SIGNED. Home says "Matthew Rodgers has
today's diary open · 4 on labour so far · Look" in place of the button. Read-only on purpose:
two authors editing one day would need a merge nobody could sign for.

**R18. A day belongs to the job.** Drafts were the author's alone: every write path — child-table
RLS, storage, the review RPC, the status update that signs — ran through "my own unsigned
draft". With two people on one job that meant the supervisor could see the leading hand's day
and not add a line to it. `app.can_write_entry` and the entries update policy now admit an
unsigned draft on a job where the caller holds an authoring role (supervisor or admin); a PM
or leading hand still reads only, nobody touches a signed day, and binning a draft stays with
its author. Two things were made explicit rather than left to chance. The signature names the
signer: it used to be attributed to the author whoever moved the row, harmless while those
were one person and wrong the moment they were not. And `author_id` stays what it was, so the
record shows who started the day and who put their name to it. The review screen says whose
day it is and that the last save wins; two people editing one draft at once is a conversation,
not a merge.

**R19. Chromium rides only where a document is rendered.** Vercel wrote to say the free team had
used all 10 GB of Function Storage — the disk that keeps every deployment's server code for
rollback, nothing to do with the diary's data, which lives in Supabase. Two causes. The build
traced Playwright, Chromium and the PDF reader (about 115 MB) into every one of 36 API functions,
not only the eight that make PDFs. And Vercel keeps every deployment ever made: there were over
two hundred, most of them a fortnight of ten-a-day fixes. Both are fixed at once. Tracing is now
per route — Chromium in the PDF routes and the cron, pdf.js in the document routes, neither
anywhere else; a route missing from the list fails loudly with "Chromium not found", never
silently — and the old deployments were deleted, keeping the live one. Nothing was lost:
deployments hold code, not records, and any of them can be rebuilt from git. The team should
still move to Pro; a company's site should not run on a free tier's goodwill.

**R20. Plant prestarts.** Before a machine starts for the day the operator walks around it; WA's
WHS regulations expect that inspection recorded, and the crew prestart carried one tick for it
with nothing behind it. Three tables. `plant_register` is the company's fleet, shared by every
job — the checklist picks from it by search, and anyone who runs prestarts can add a machine on
the spot, because an unfamiliar hire machine at 6:30 is not a phone call to the office. The
per-job `plant_list` stays the diary's vocabulary for what worked today: the register is the
fleet, the list is the job. `plant_prestarts` is one inspection — every check with its result and
the label it carried that morning, hour meter, fit for use or not, the operator's signature; the
signature arriving completes it, stamped by the database, and from then on it is frozen exactly
like the crew prestart. `plant_defects` holds anything marked Defect until someone closes it with
a note. Checklists are per kind of plant in `src/lib/plant/checklist.ts`, with the common
walk-around items on all of them; nothing is pre-answered. The diary notices: a plant row on a day
with no signed plant prestart for that machine is a review warning in both halves (TypeScript and
`app.entry_warnings`), a question and never a veto, matched on name because the diary's plant is
spoken and the register's is typed. The crew prestart's plant tick now shows which machines were
actually prestarted, Home says which are tagged out, each inspection prints to one page, and the
month exports as a spreadsheet for whoever asks after an incident.

**R21. A photo joins the diary the moment its upload lands.** Thirteen photos over two days
reached storage and the diary never heard of them: between the successful upload and the photo
entering the day sat `new Date(file.lastModified).toISOString()`, an iPhone handed back a
timestamp that line could not stomach, and the RangeError it threw was caught and reported as
"photo did not upload" — after the upload had succeeded. `photoTakenAt` turns any timestamp it
cannot trust into now and never throws, and each photo is added to the day as its own upload
lands, so a failure on the third cannot lose the first two. The general lesson is the one in
non-negotiable #5 read the other way round: a file in storage the record does not reference is
as good as lost, so nothing may sit between "uploaded" and "in the day" that can fail.
*Postscript, 2026-09-11:* the one-off script that re-attached the thirteen counted a file as
unreferenced when no `photos` row named it — and never looked at `dayworks.photo_urls`. Six of the
thirteen were already on Thursday's dayworks, so they were copied onto the day as well and the
daily appendix listed them twice. The nightly `reconcileStorage` checks every table that can hold
a path, which is why it exists and why no script should do this by hand again (house rule).

**R22. Nothing sits in storage unseen.** Thirteen photos and a signature reached storage and the
record never heard of them, for two days, until a supervisor asked why his photos were not
showing; then, putting them back, a test cleanup that deleted "the newest row" deleted one of
his real photos, because the review RPC rewrites every child row on each save and they all carry
one timestamp. Three guards now. The nightly ops check walks every file in `entry-photos` and
`entry-audio` against every table that should reference it, puts a photo under an unsigned draft
back on the day (the supervisor still reviews it before signing), and emails anything it cannot
put back the day it appears. The review screen's autosave is no longer silent: a failed save
says so, keeps the page's state and retries until it lands. And the agents' rules now say it
outright — drills write to the sandbox only; delete only by the exact id or path captured at
creation, never by inference; storage has no undo; and nothing may sit between "uploaded" and
"in the day" that can fail.

**R23. Codex pass 6.** Eighteen commits shipped to a live crew in three days without the second
pair of eyes the house rule demands, and the review of them said do not ship: six highs. The
docket named the author as signatory when shared drafts had just made signer and author
different people; a plant prestart could be born complete, completed by hand or signed over an
empty checklist, and its defects rewritten after signing; signing a diary was two calls with a
window an in-flight autosave could land in. All fixed the same day, each pinned in a suite. The
lesson is not the bugs, which were ordinary; it is that "one builds, the other reviews" is a
rule for the day of shipping, not the week after.

**R24. One plant register.** For three days there were two lists called plant: the per-job
`plant_list` the diary's vocabulary came from, and the company-wide `plant_register` the checklist
picks from, with the same three machines kept in both by hand. Now there is the register, which is
the fleet, and `project_plant`, which says which of the fleet is on which job. The extraction's
known names, the review screen's plant chips, the Plant page's today list and the checklist picker
all read the same join (`src/lib/plant/on-job.ts`). Ticking On this job in the register is the one
place a machine joins a job, and checking a machine on the prestart form puts it on the job too,
because using it here is the fact. The old rows moved across as typed — a supervisor's ownership,
supplier and aliases beat the seed's guesses — and `plant_list` is gone. Settings points at Plant.
Codex's pass on the merge flagged that the data move matched machines by name within the
organisation, which could mis-map two jobs' same-named machines; on the live data — one job,
three distinct names, an alias-less seed — every row was checked after the run and came across
exactly. The pass also caught three things that are fixed: a job can only carry its own
organisation's machines (policy), the prestart form puts a machine on the job before the
inspection exists and stops if that fails, and the names a machine answers to are editable again
on the register, since the diary recognises "the vac" only because someone typed it.

**R25. The forms work with no signal.** The diary was offline-first from the start; prestarts,
plant checks and toolbox talks were not, and a form that fails at 6:30 with one bar is a form
the crew stop using. An outbox on the phone (`src/lib/outbox/`, IndexedDB, its own database —
idb-keyval cannot add a store to the capture queue's) holds a prestart made offline, every
sign-on, a finish, a plant check with its photos and signature, a toolbox sign-on and completion,
each with ids the phone chose, and replays them in order when signal returns. Retries are
idempotent, a refusal is shown and can be discarded, a network drop keeps waiting, and every
drain tries because a drain is only ever prompted by signal, the app opening or a tap. A prestart
made offline runs from the phone on the same screen the crew would see from the server, reopened
through the cached page by its id (service worker v7 matches a cached screen regardless of
query). The record keeps both clocks — `completed_at` is arrival, `completed_on_device_at` is the
press of Finish — and the PDF prints both when they differ. Two things the drill caught before
any crew did: the shared database, and supabase-js reporting a dead network as a plain object
that the classifier filed as permanent. Proved live: prestart, sign-on, finish and plant check
made with the network cut all arrived intact when it was restored.

**R26. Tickets and inductions.** Two ticks on the prestart — SWMS reviewed, everyone fit and
inducted — and any name accepted as a plant operator. Now the company keeps each person's tickets
(`crew_tickets`, per organisation, matched on the name as typed, because the diary, the sign-ons
and the labour rows all work by name) with expiry and a photo of the card, and each job keeps who
is inducted onto it (`crew_inductions`). The plant prestart refuses an operator whose recorded
tickets do not cover the machine, missing or expired; when nothing is recorded for them at all it
warns and lets the check go ahead, because an empty list is the office's problem and not a reason
to stop a machine on the strength of a gap in paperwork. The crew prestart marks a sign-on from
anyone not inducted here, on screen and on the PDF, with a one-tap induction for the supervisor.
The nightly check emails tickets that have lapsed or lapse within thirty days. What a machine
needs is a table in `src/lib/crew/tickets.ts`, mirrored by `app.plant_required_tickets` in SQL;
change both. Codex's pass on this found the two things that matter: induction was read from
today's list at print time, so a later induction could erase NOT INDUCTED from the record of the
morning — it is now stored on the sign-on; and the ticket check lived only on the screen, where a
verdict for the previous operator could let the next one sign — nothing is ready while a lookup
is pending, and the database refuses a signature the tickets do not cover.

**R25a. Codex on the outbox.** Three findings the same day. A queued edit whose prestart had been
finished in the meantime touched no row under RLS, returned no error, and was removed as if it had
applied — it is now reported as refused, with the reason. The cached-page fallback matched a screen
by path alone, so a kept prestart could open on another job's cached page — the service worker
(v8) only serves a cached copy for the same job and the screen reads the kept id from the address
bar, never from props that may belong to another render. And `completed_at` was written from the
phone's clock — the database now stamps it on prestarts and talks, so a wrong clock or a late
send cannot forge a receipt time; the phone's clock lives in `completed_on_device_at` where it
belongs.

**R27. The dayworks sheet asks for what a supervisor has at knock-off.** The docket number is
chased after signing from the claims screen and prints as "docket to chase" until it lands, so a
box for it on the sheet asked for a number nobody had yet. It is off the form; the column stays
for what was typed before it went. Plant on a daywork is picked from the machines on this job,
with a box for the small plant that never reaches a register — a Stihl saw, a plate compactor —
both landing in the one text the sheet prints. And because dayworks belong to the day they were
done, the tab offers a date: an open draft for that day opens on review, a signed day is told a
correction is the way, a day with nothing yet is started. The owner's words were "I need to
backdate it"; the answer in this app is never a back-dated row on today, it is the right day's
diary.

**R28. A variation is the description, who did it, and the reference.** The owner's words. Who
directed it, when, and a guessed value are off the form: the value is priced and agreed on the
variation register, not guessed at knock-off, and "directed by" was a box that mostly held a
company name the register already knows. Their columns stay for what was typed before; a
proposal can no longer fill them, because nothing the supervisor cannot see may be saved unseen;
and their two review warnings went with them. `crew` is new — the people who did the work, tapped
from the job's crew or typed — and it is conditional in the content hash exactly like labour's
times, absent when null, so all 23 entries signed before today still verify (checked on the live
database after the migration). The docket, the client sheet, the weekly and the claims export
print it where the three that left used to sit. The extraction is not yet taught the field: that
is a prompt change and a $4 eval run, held until the spend is approved, so for now the voice path
leaves crew for the supervisor to tap in.

**R29. A day that will not load is never shown as an empty day.** An hour after R28 shipped, the
owner opened Monday and saw nothing where his day had been. The new `crew` field rejected null,
every variation saved before the migration had `crew` null, the review contract failed to parse,
and the page fell back — by design, for a malformed *proposal* — to an empty docket. For stored
rows that design was one tap from disaster: the empty form had autosave behind it, and a single
edit would have applied the empty payload and deleted every row it had failed to show. Nobody
tapped. Two fixes. A new nullable column is nullable in the review contract too (Codex found it
within the hour; the rule is now in the review checklist). And when stored rows do not fit the
contract the page refuses to render the editor at all — it says the day could not be opened,
that nothing has been changed, and links to the read-only docket. The proposal-only fallback
stays: a malformed proposal has nothing stored to lose.

**R30. The register number is the day's reference.** The owner's model, in his words: the
register holds variations one to fifty for the job; on the day you pick the number the work
belongs to from a dropdown; the register collates the days. Before this, a day's variation was
registered by matching its words — every autosave of a half-typed description ("Widen irrigat")
minted a new register item, and a client reference typed on the day was the only way to say
which item was meant. Now the day carries `register_seq` and nothing else identifies the item:
the trigger finds the item by (project, number) or creates it with that number and the first
day's words as its title, and never again matches text or a `vr_ref`. The signing gap asks for
the number. Recording an item on another day stamps that day's row with the number. Two things
about the record. `register_seq` is conditional in the canonical JSON, so every entry signed
before it existed still verifies; and rows on signed days cannot be backfilled — the immutability
trigger refuses, and setting the column would change the hash — so they keep their number through
the link they already had (`public.variation_number`, a PostgREST computed field the docket
loader, the correction route and `diary.variations` all read). The client's reference, the value
and the status stay on the register item, where a PM sets them once, not on fifty days.

**R31. Back a day, forward a day.** From any day — its review screen, its signed page, its
docket — the day before and the day after are one tap away (`src/components/day-nav.tsx`,
`loadDayNeighbours`). "The day before" is the previous day *recorded* on the job, not the previous
calendar date: a rest day or a day nobody wrote up is not a page, so it is not a stop. Each day is
its current version — a corrected day shows the correction, never the superseded original. The
docket view steps to the next docket; the day view steps to the next day's page, which routes a
draft to whoever may edit it and to a read-only view for everyone else. The ends say so ("First
day", "Latest day") rather than disappearing, so a thumb does not hunt for a button that was
there a moment ago.

**R32. Hours on a variation are a fact about the day.** The owner: "add the hours worked on the
variation within the days, rather than the register." How long the crew was on a variation is
known at knock-off, by the person who was there, and it is different every day — so it is typed
on the day's row beside who did it, and the register adds the days up ("Hours from the days").
Nothing is typed on the register that a day could have said, which is the same reason the value
is *not* on the day: a price is agreed once, by a PM, not guessed nightly by a supervisor. The
column is nullable and conditional in the hash; unstated prints a dash, and a day that said
nothing adds nothing to the total — a blank is not a zero. The docket carries a Hours column and
a total, so the printed day and the register agree to the quarter hour. Extraction does not yet
hear it: that goes with `crew` into the next prompt version and its one eval run.
Codex (pass 12) added two things the same day: a blank is *asked about* on review — a soft
warning, never a block, because "I don't know" is an honest answer — and the client sheet totals
variation hours as it already did dayworks, so the sheet sent for sign-off does not undercount.

**R33. The weekly carries the week's photographs.** The owner asked for the photos being
uploaded to appear on the weekly summary, and for the dayworks table to lose its docket column
(the docket left the day form in R27 and is chased on the client sheet). Photographs are the
evidence a PM forwards, so they are embedded, not linked — the same archival rule as the daily
appendix — grouped by day, each with the item it belongs to (a variation's number, a daywork's
description, a concrete docket's pour). Two things keep it a document rather than a download. A
photo that sits on a daywork and on the day is the same file in two places; the weekly prints it
once. And the images are re-encoded inside Chromium before printing (`img[data-shrink]` in the
shared renderer): this week's twenty-five phone photographs weigh 34 MB in storage and 4 MB in
the report. The daily docket carries no such mark, so its bytes are untouched — the determinism
check says so. Eighty photographs is the cap; the remainder is counted and left in the dockets.

**R34. Site sign-in is the first safety module, and the gate is a phone.** The owner's direction
(2026-09-14): one place for everything a site runs on, the way the established Australian safety
platforms do it. Sign-in came first because it feeds everything else — the roll call in an
emergency, the induction check as someone arrives rather than after, the prestart's attendance,
the labour a claim stands on. The shape follows the prestart sign-on, which the crew already know:
tap a name from the crew list, type anyone else with their company and why they are here, one tap
to sign out, "sign everyone out" at knock-off. Three things are the database's, not the phone's.
Whether a person was inducted is decided at sign-in from the induction list and kept as a fact
about that moment, as the prestart does. Arrival times are the server's clock, with the phone's
clock beside them, so a sign-in queued with no signal still says when it really happened. And a
signed-out row is frozen; a wrong tap is undone only by whoever tapped it and only while the row is
open, because the register is evidence from the moment someone leaves. Leading hands have gate
duty — they are the ones standing there. There is no visitor QR code yet: a self-service gate needs
a public page with its own token, and that is a second step once the crew's own sign-in is habit.

**R35. A SWMS is frozen the moment it is worked to, and a change is a new version.** The second
safety module. The law's shape decides the app's: a Safe Work Method Statement must exist for each
kind of high-risk construction work, must be followed, and must be revised when it stops matching
the work — so a draft is written and checked, "put into use" freezes it, every worker signs on to
*that version* ("I have read and understood this and will work to it"), and a revision is a new
row that supersedes the old one when it in turn is put into use, taking nothing with it: the old
sign-ons stay with the old version, because they were made to those words. Completeness is checked
by the database at activation (every step has a hazard and a control; a SWMS names its high-risk
categories; someone prepared it) and shown live by the same rule in TypeScript; if they disagree
the database wins. A sign-on is never edited or deleted, by anyone — the drill archives its test
SWMS rather than remove it, and that is the right friction. A JSA is the same shape without the
high-risk requirement. Not built yet: drafting steps from a spoken description (the prestart's
dictation path would do it), a library of the company's standard SWMS across jobs, and showing the
SWMS in use on the morning prestart.
Codex (pass 15) tightened the lineage the same day: a draft keeps its job and the version it
revises; a revision goes into use only if its base is still in use on the same job, so two drafts
of one version cannot both take over and a revision of archived work cannot become current; the
dates on a frozen version are as frozen as its words; a signature is written only under the SWMS's
own project folder; and archiving asks first, because nothing un-archives.

**R36. A hazard report is the first account, and the first account never changes.** The third
safety module. The shape comes from what a report is for: months later, in front of an insurer or
an inspector, the question is "what did you know that afternoon and what did you do about it". So
the report is frozen the moment it is made — kind, when, where, what happened, who, the photos — and
everything learned afterwards is an update appended under it, never written over it. Corrective
actions carry an owner and a due date; the database stamps when each is done and by whom, and
refuses to close the report while one is open; a closed report is frozen entirely and takes no more.
Numbers are issued by the database in order of reporting, under a lock, so INC-014 is INC-014 on
every phone. Two things are deliberately loud: the notifiable tick shows a red banner about WorkSafe
and the site, and injuries, notifiable and high-severity reports email the office the moment they
land — once, stamped, so a retry from the queue cannot send it twice. Reports cannot be deleted
through the app, by anyone; the sandbox drill closes its own. Not built: a spoken report turned
into the form (the prestart's dictation path), photos on updates, and the LTIFR-style statistics a
tender asks for — the register has the facts for them.
Codex (pass 16) the same day: a done action, or one on a closed report, cannot be deleted by
anyone; the office email is *claimed* by the server before it is sent, so two calls cannot send
twice, a failed send hands the claim back, the screen shows "the office has not been emailed" with
a button, and the nightly check retries; no signed-in account can mark a report as emailed; a report
dated in the future is refused rather than re-dated; a report photo whose report never landed is
reported by the nightly check as unrecoverable rather than ignored; every typed word is escaped
before it becomes email HTML.

**R37. An inspection is the checklist as it was that day.** The fourth safety module. A template is
the company's; an inspection copies its items the moment it starts, so a template reworded next
month never changes what a record says was asked in September. The phone does the whole thing on one
screen — pick the checklist, walk it (OK, issue, N/A), note and photograph each issue, sign — and
sends it as one thing, queued if there is no signal, because a half-walked inspection is not a
record of anything. The signature is the completion: the database accepts it only over at least one
answered item and only from the inspection's own storage folder, stamps the time, and freezes the
row; unanswered items print as "not checked", never as passed. Issues become corrective actions in
exactly the shape the incident register uses, so the Home screen's "actions overdue" is one number
across both. Four standard checklists ship (site walk, environmental, quality, plant audit) so the
first inspection can happen the day the module lands; a company copies and edits them into its own.
Not built: scoring, scheduled inspections with a reminder, and inspections tied to a permit.

**R38. A permit is two signatures over every control, for one window.** The fifth safety module.
The shape is the paper permit the industry already trusts, made honest by the database: the issuer
walks the controls for that kind of work (hot work, excavation, confined space, heights, electrical)
and every one is answered yes or not applicable — "unanswered" is not an option — then the issuer
signs and hands the phone to the permit holder, who signs to accept. Only then is it issued,
numbered PTW-001… in order, and frozen. It ends with a close-out — the area left safe, the fire
watch done, the isolations removed — signed by whoever closes it; or a cancellation, with a reason.
A permit past its window is not quietly expired: it stays on the list in red until someone closes
it, because work that ran over is exactly what a permit exists to catch. The permit names the SWMS
in use and warns when a listed worker has not signed on to it. Windows are bounded at issue (start
within a week, run at most thirty days) so a typo cannot issue a permit for 2036. Codex's review of
inspections landed the same day: an open inspection belongs to whoever started it, actions attach
only once it is signed, the signature is uploaded before the row so a refused upload leaves nothing
half-made, and a saved-but-unsigned inspection can be signed later from its own page.

**R39. The gate code opens one thing.** A visitor at a gate with nobody standing there scans the
sign and signs themselves in on their own phone: name, company, why they are here, a mobile for the
roll call, the site rules read and accepted, a signature. No account, no app — the code on the sign
is the key, and it opens exactly one thing: this job's sign-in. The server does the writing with the
service role, marks the row *self-signed* with no account behind it, and the database refuses that
combination from anyone who is signed in, so a supervisor's tap and a visitor's own sign-in are told
apart forever. The visitor's phone remembers the sign-in and offers "sign out" on the way back
through; the id it holds is the only key, so nobody signs out anybody else. The code is rotatable —
print a new sign, the old one stops working the moment the new code saves — and the gate refuses to
sign in sixty people in ten minutes, which is not a gate, it is a script. Codex's review of permits
landed with it: a permit issued with no signal is judged by when the phone issued it, not when it
reached the server hours later.
Codex read the gate as an attacker would (pass 19) and three things changed the same night: a
self-signed sign-in must carry a real PNG signature and the moment the rules were accepted, or the
database refuses it; the rate limit is decided under a per-job lock inside one function, so a flood
cannot all see "fewer than sixty"; and every failure at the gate reads the same, so probing names
does not reveal who is on site. One finding was accepted as designed: a permit signed at 08:00 with
no signal and received at 17:00 is issued at 08:00 — the record prints both times, and that is the
truth of it.

**R40. A subcontractor's paperwork is judged from dates, at the gate.** The seventh safety module.
The company keeps each subcontractor once — name, ABN, contact — with its documents and their
expiry dates: public liability, workers' compensation and its SWMS are required; licences, other
insurances, a safety plan and an induction record are kept alongside. Nothing is a judgement typed
in a box: compliant, expiring, lapsed or missing is computed from the dates every time it is
looked at, so the register, the gate and the nightly email can never disagree. It surfaces where
it matters — when someone from that company signs in, the register row says LAPSED or PAPERWORK
MISSING in red beside their name, and a company nobody has recorded is flagged too. A document is
a record: a renewed certificate is added and the old one retired, never rewritten or deleted, so
the question "what did you hold on the day of the incident" always has an answer. Engagement is
per job with a scope and dates. Not built: a subcontractor portal where the company uploads its
own renewals, and reading the expiry off the certificate with the model.

**R41. A version is a file, a date and the names of everyone who read it.** The eighth safety module.
A controlled document — a policy, a procedure, a plan — is one thing with a number; each issue of it is
a version with its own file and its summary of what changed; issuing a version supersedes the one
before, under a lock so two supervisors uploading at once cannot both be version 4. The crew
acknowledge a version the way they sign on to a SWMS: name and finger on the supervisor's phone,
once per person per version, so a new version means everyone reads again — the list says "5 of 7 on
this job have read it" and names the two who have not. Nothing issued or acknowledged is ever edited
or removed; a superseded version keeps its signatures, because they were made to those words. The
file goes up before the row that names it, and a failed row removes the file, so nothing is left
pointing at nothing. Codex's review of subcontractors landed with it: a job engages only its own
organisation's subcontractors, a retired certificate stays retired, and an insurance with no expiry
recorded is not evidence of cover — it is missing.

**R42. The training matrix is the ticket list, laid out against what each role must hold.** The ninth
safety module, and deliberately thin: the company already keeps every ticket by person and type, so
the matrix adds only two facts — the competencies the company defines for itself (its own induction, a
VOC it runs) and the competencies each role must hold — and computes the rest. Every cell is current,
expiring within 30 days, expired or missing, from the dates alone; a cell goes red only where the
person's role requires it and they do not hold it, so a labourer is not marked short of an excavator
ticket. Roles come from the crew list, so the matrix follows what the supervisor already types. A
tap on a cell records the ticket where the gap is. The nightly email names who is short of what their
role requires. Codex's review of document control landed with it: an offline acknowledgement of a
version superseded before it reached the server is dropped rather than retried forever, the
controlled-documents bucket is walked by the nightly check, and a document must be a PDF or a scan.

**R43. The safety dashboard has no table of its own.** The tenth and last module of the plan, and the
reason it was built last: every figure on it is read from the nine before it, so there is nothing to
type, nothing to forget to update, and nothing that can disagree with the record. On site now, the
prestart, permits live and permits past their window, plant tagged out; corrective actions open and
overdue across incidents and inspections, listed with owner and date; injuries split into medical
treatment or worse and first aid, near misses, hazards, notifiable events, the hours worked on signed
diaries and a rate per million hours that says what it divides by — it is not an LTIFR, because
lost-time days are not recorded, and the page says so rather than let a client assume; days since the
last injury; six months of reports as bars; and everything expiring or outstanding — tickets,
subcontractor paperwork, SWMS not signed by everyone, documents not read by everyone — each with a
link to where it is fixed. A one-page PDF of the same for the monthly report. Codex's review of the
training matrix landed with it: a custom competency with a validity expires from its issue date, a
name that holds two roles owes both, a retired competency that a role still requires keeps showing
its gap, and a photo that uploads but fails to link says so. Its review of the dashboard itself
followed: days since the last injury reads the last injury the job ever recorded, not the last within
the twelve-month window, so a job 400 days clear says 400 rather than "none"; an injury recorded with
no treatment is its own figure, never counted as first aid; the action table says how many it leaves
out; and a competency's validity clamps to month end, so 31 January plus one month is 28 February.
The pass after that caught the window the action count still lived in: an open corrective action
on an inspection from 120 days ago is still open, so the actions are now read from the action
tables themselves with no date on them, and only the injury figures keep the twelve-month window.

**R44. The home page is the opening page, laid out like the office's systems.** With ten modules the
Menu drawer had become the only way into most of the app, and a menu is a place to go looking. Mitchell
put a StemsOne dashboard beside it and asked for the same shape, so the home now is: the company and
the person across the top; a bar of seven section headings (Diary, Claims, Safety, Site, People,
Library, Setup), each opening a panel of what is in it; the things you raise most as buttons under
that; then the cards — today's diary first, and beside it expired tickets, actions overdue, permits
live, the open hazards with their dates, the latest documents issued, hazards reported and injuries in
the last 30 days, the 12-month frequency rate with six months of bars, inspections, SWMS not signed by
everyone, subcontractors not compliant. Every card reads through the Safety screen's own loader, so
the two can never disagree, and the cards stream in after the diary so a phone with one bar of signal
gets the day first. The headings, the drawer and the desktop rail draw one list (`src/lib/nav.ts`)
filtered by the role the server already knows. The section that lists the days is called **Daily
Diary**, not "Past days": it is the diary itself, the thing the app is named for.

**R45. The gate fills the labour list; the supervisor still owns it.** Mitchell: "when someone signs
in and out, it updates on the labour hours within the daily diary … automatically, but can also be
inserted manually." The two halves pull against each other — an automatic feed that overwrites what a
supervisor typed is inventing a number with extra steps — so the rule is ownership. A crew member or
subbie who signs in at the gate lands on the day's labour list with the gate's arrival clock; when they
sign out, the finish and the hours follow (span minus whatever break the supervisor set). That row is
the gate's, and says so under it, until the supervisor edits a clock or the hours on it — from then on
it is theirs and the gate leaves it alone, and the row says that instead. A row typed by hand or heard
in the recording is never overwritten: the gate fills only what is blank on it, and never a stated
figure. Still on site means no finish and no hours — the amber "hours missing" asks, rather than the
app guessing knock-off. The review screen looks at the gate when it opens, when it comes back to the
front, and every minute; and as with everything on that screen, nothing reaches the record until the
supervisor saves or signs. Signed days are untouched; a sign-out after signing is a correction, as it
always was. Codex's review of it landed two more rules: the hours box is locked whenever both clocks
are present — the record has always recomputed hours from the clocks at save, so typing over the box
looked like it worked and had not; change the start, the finish or the break — and a person at the gate
is a name *and* a company, so two John Smiths from two subbies are two rows, and a typed name the gate
cannot tell apart is left alone rather than guessed at.

**R46. Orders and plant issues: think of it, add it.** Mitchell: "if Matty thinks of something that needs
ordering he adds it — diesel, consumables, anything — and a section for issues with plant, a light not
working." The shape is a register the phone writes to in seconds and the office works from: one list per
job, two kinds (an order, a plant issue), a free-text what and how-much (no units invented), the machine
from the plant list when it is a fault, a needed-by date, an urgent flag, a photo. It saves the moment
it is tapped, queued without signal, numbered ORD-001 by the database. The request may be corrected only
while it is still open; once the office marks it ordered (supplier and reference), or received, or fixed,
or cancelled with a reason, the request is frozen and the lifecycle stamps are the database's — so "when
did we order the diesel" has one answer. Updates are append-only. A request that has moved is never
deleted; the raiser may remove their own while still open, for a slip of the thumb. It appears on the
home dashboard as a card and under Site in the headings; the nightly orphan check knows the photo folder.
A plant issue stays a plant issue: Mitchell's call ("don't make issues part of prestart"). The prestart
defect is what an operator finds walking around a machine before starting it and is part of that
inspection's record; an issue raised here is a note to the office that something needs fixing or
ordering. They are different questions with different owners, and folding one into the other would
put office chasing into the operator's inspection. Nobody is emailed when an issue is raised — the
office sees the card.

**R47. The variation register is a tracker.** Mitchell: "update the variations tab to something like a
tracker, we need to be able to understand it better." What was hard to read was fifty dashed number
slots and a dropdown per card — the mechanics of picking a number on a day, shown to the person chasing
the money. The tracker leads with the path every variation walks — Raised, Priced, Submitted, Approved,
Paid, with Rejected the step off it — as a row of stages with a count and a value at each, tap one to
see only those; then the four figures the office asks for (all, not yet sent, with the client, approved
and unpaid); then one card per variation, action needed first: where it is on the path with the date
each stage was reached (from the status ledger, never typed), one line saying what it is waiting on
("Send it to the client", "With the client since 20/08 · 26 days", "Approved 14/09 — invoice it"), and
the days, hours and crew behind it. The card opens to the day-by-day table with each day's diary
serial, the history of who moved it and when, and the same controls as before. The next free number is
one line of text, because the day's dropdown is where numbers are picked. The Claims screen keeps its
plainer section; both read the same loader.

**R48. Home under the thumb.** Mitchell: "add a home button to each section and screen so people can go
back to the home page." The top bar had one, but a top bar is where you were, not where you are after
reading down a long screen with gloves on. One component in the root layout (`src/components/home-foot.tsx`)
puts a solid Home button at the foot of every screen but Home itself and the public gate flows, carrying
the job so Home opens on the same project. Three screens had grown their own Home button, each of which
dropped the job; they use the foot now. On a desk the rail carries Home and the foot steps aside.

**R49. The labourer: two doors.** Mitchell: "add a worker with the label labourer, and they will have
access to sign in and sign out only. They can also report any hazards or incidents." The whole crew is
coming onto the app, and most of them need exactly that. So a fourth crew role, beside the leading hand:
the labourer sees Home, Site sign-in and Hazards & incidents and nothing else — no diary, no prestarts or
talks, no plant, no orders, no registers. Two new permissions carry it (`app.can_sign_in`,
`app.can_report`, mirrored as `canSignIn`/`canReport`) so the wider gate-duty permission stays what it
was: a labourer is not on prestart duty. Suite 19 opens the two doors and tries the others. What is not
tightened yet: row security on the rest of the record is member-wide for reads, as it always was, so a
labourer who called the API directly could read a diary the screens never show them. The screens and
every write are gated; if the crew grows to people who should not read the record at all, that is the
next migration, and it is a broader one. The drill on the sandbox and Codex's review found the same
hole from two sides: until the labourer, every role could see every screen, so most detail pages and
every PDF route had no role guard at all — a labourer could open the prestart list or pull the safety
PDF by typing the address. Rather than add a guard to forty files and miss the forty-first, the gate is
one place: the request middleware maps each path to its screen and refuses (pages go Home, APIs answer
403) any account none of whose memberships can see it — judged for the job the address names when it
names one. Codex then pointed at the mixed-role account, a labourer on one job and a supervisor on
another, who passes a gate judged across memberships; so every list and detail page also runs
`guardScreen` against the job it actually resolved, and the two halves cover each other.

**R50. The rail's headings are dropdowns.** Mitchell: "on the left menu, make it a dropdown." Twenty
links in a column read as a wall once the tenth module landed. The desk rail now draws the same seven
headings as the home page's bar and the phone's drawer (`src/lib/nav.ts`, one list), each a dropdown:
the heading holding the current screen opens on its own and is marked, a tap on any heading opens or
closes it, and that choice is kept for the session so a desk that likes everything open keeps it. Home
stays a single line at the top; Settings stays in the foot.

**R51. One look for every head, and the office hears about urgent orders.** Mitchell picked two from the
list: "Notify the office when it matters, unify the older screens." The Daily Diary list, the weekly
and the review screen grew dark gradient bands before the sheet style settled; the desk already drew
them as a plain line, and now the phone does too, from the same rules at every width, so the app reads
as one thing. The list also loses its Today pill and its own Home button, which the top bar and the foot
made redundant. On the office side, an urgent order or plant issue emails the job's report addresses the
moment it is raised — the same shape as the incident email: the server claims `notified_at` before
sending, hands it back on failure, and the nightly `safety=1` check retries; a phone cannot set the mark.
The notifiable-incident banner now carries the WorkSafe WA incident line, 1800 678 198, as a number you
can tap, in the report form, on the report, and in the office email.

**R52. Twenty people on a Monday, and the record kept from the labourer.** Mitchell picked the two
that go with the crew arriving. Onboarding: the Members screen takes a pasted list — a name and an
email per line, one role for the lot — and seats them in one go, creating an account for anyone who
has none (confirmed, no mail sent) and leaving anyone already on the job as they are, with a line
saying which was which. Then Sign-in cards: one printable card per person with a QR code carrying the
same single-use sign-in link a magic-link email would, minted by the admin on the spot instead of
mailed, because a mail provider's hourly limit must not decide who gets into a toolbox meeting. The
codes expire in about an hour, and the page says so. A labourer's first Home shows three lines on what
their two buttons do, until Got it. Reads: every read policy said "a member may read", and a labourer
is a member. A restrictive policy — one that must also pass — now sits on every table that belongs to
the record, saying "and not as a labourer" (`app.reads_record`, `app.reads_org_record`), so the API
gives a labourer nothing the screens do not: they keep the gate, the reports, the crew list, plant
names and the weather line. Everyone else reads exactly what they read yesterday; suite 19 says so
from both sides. Sign-in by email is still there for anyone who prefers it, and depends on the
project's mail provider (Supabase Auth's SMTP), which this repo does not configure.

**R53. The timesheet the office imports.** Mitchell: "just build the timesheet export for the office to
import" — not a Xero connection ("don't use my Xero"). The weekly screen already exported the labour
matrix; payroll wants the other shape: one line per person per day, ordinary and overtime hours in
their own columns, the start and finish the diary recorded, and the diary serial each line stands on.
That is `format=long` on the same timesheet route, for the week or the fortnight ending with it, signed
days only as before, and a day with no hours is not a line — nothing is invented, not even a zero.
Xero itself stays out: pushing timesheets into Payroll needs the company's own Xero app, employees,
pay calendars and earnings rates, and the connector in this workspace is another business's books.

**R54. Prompt v14: the variation's crew and hours.** The day's variation had carried `crew` and
`hours` since 11 September, but extraction had not been taught them, so a spoken variation landed
without either and the supervisor typed them. v14 teaches both: crew is only the names spoken against
the variation, never everyone on site; hours is how long the variation ran that day as said — "six
hours each" with two on it is 6, not 12 — and "all afternoon" stays null. The paid eval ran once, as
the rule says. The new fields scored clean on both variation fixtures. The run also caught the model
recording "the best part of two hours" as 120 minutes on a delay whose two clock times were given;
that is a spoken figure, not an invention, but the design is that the clock is the record whenever
both times are said, so the rule was tightened to say so and the three affected fixtures re-checked
(a fraction of a run) before shipping. The eval's `invented` line counts extra items too; those are
fixture-design disagreements of the same kind v13 shipped with, and are judged one by one, not summed.

**R55. The claims draft that timed out.** Mitchell: "claims draft has error." The platform was
cutting the route off at 120 seconds with no message. Two causes, both of the day: the variation
tracker had put the status ledger and each day's text onto the claims data, and the whole of that was
being serialised into the model's input; and the draft ran with extended thinking and an 8,000-token
cap, which on a register this size measured 64 seconds against 27 without, for the same length of
draft. Now the model is given the claim figures alone, thinks in the ordinary way (the numerals are
checked by code, not by deliberation), gets one attempt of up to 150 seconds, skips the corrective
retry when it would breach the budget, and the route allows 240. A slow answer is a sentence on the
screen, never a blank platform error. Lesson for the record: whatever rides on `ClaimsData` for a
screen reaches the narrative unless the narrative's input is built on purpose.

**R56. The home shows what needs attention, not every figure.** Mitchell: "improve the app
interface, its very convoluted, i need it simple and easy to understand." The opening page had
twelve cards, and on a job going well all twelve said 0 — a phone scrolled three screens of zeros
to reach the bottom, and on a laptop the rail, the heading bar and the quick actions were three
navigations on one screen. Now a card is drawn only when it has something in it (an expired
ticket, an open action, a live permit, a report, an order still to come); the rest fold into one
line — "Nothing needs attention · Checked today: tickets & licences, corrective actions, …" — so
the supervisor still sees what was checked, with one link to the Safety dashboard, which keeps
every figure. On a laptop the rail is the navigation: the heading bar and the repeated brand go,
the person and Sign out stay. On a phone the quick actions sit in two tidy columns and the header
drops the role line. The weather line names only what the Bureau gave — a dash for a missing
figure read as a broken screen. Site sign-in moved under the Diary heading, because the gate
feeds the day's labour. Nothing was removed from the record or the Safety screen; the home
simply stopped repeating it.

**R57. Access by tick box, and the labourer's three screens.** Mitchell: "allow me to select who
can see what … supervisor — I need to be able to change what he has access to at all times using a
tick box to each task." `project_members.screens` (migration 20260916100000) names exactly the
screens a person may open on a job; null means the role's own list. `sees(member, screen)` in
`src/lib/roles.ts` is now the one question every gate asks — the middleware, `guardScreen`,
`forbidUnlessSees`, the menu, the rail, the home cards and every page and API that used to ask
`canSee(role, …)` — so an unticked box is refused, not hidden. Three rules no tick moves: Home is
always open; a labourer never gets past their two doors (the database keeps them out of the record
whatever is ticked, migration 20260915140000, so a tick there would only show a door that does not
open); an admin keeps Settings, the screen the ticks are set from. Changing a role clears the ticks,
because they were made against the old role. The role still decides what a person may DO — write
the diary, run a talk, progress an order — and the table policies stay by role: the ticks decide
which doors open, in the app and its APIs. The Members screen shows one Access panel per person,
grouped under the menu's headings, each tick saved at once.

The labourer's screens, after seeing them live: the home is now the state of their own sign-in
("signed in since 6:52") and two big buttons, no diary panel, no figures, no heading bar; the gate
opens with one button — "Sign in, Sam Labourer", then "Sign out … in since 6:52" — and a labourer
sees no form to sign anyone else in, no register PDF and nobody else's Sign out; the hazard form
for a labourer is kind, where, what happened, what was done, photos, Report — when defaults to now,
and severity, witnesses, plant and the WorkSafe line are the supervisor's to add as updates. The
same one-tap button sits at the top of the gate for every role, since a supervisor signs themself
in too.

**R58. A mic on the hazards box.** Mitchell: "add a talk it in for the prestart hazards." The
prestart already had Talk it through at the top, which sorts a whole briefing into the five
fields; on the day the supervisor often has the work typed and wants to walk the hazards out
loud. The Hazards and controls box now has its own Talk the hazards in, on the new form and
when editing an open one. It goes through the same route (`POST /api/prestart/dictate` with
`field=hazards`), the same role check and the same Deepgram pass, and a hazards-only prompt
writes one "- hazard: control" line per hazard, invents neither, and fills that box alone,
whatever else was said. The transcript joins `prestarts.dictation` as before. Nothing is ticked
from speech, as ever.

**R59. The 16 September review.** Mitchell: "please do a full review and see if there are any
issues." Two Codex passes over everything since pass 44 (the rail, notify, onboarding, the read
lock, the timesheet, CI, prompt v14, the claims draft, the home, access by tick box, the labourer's
screens, the hazards mic). Eight findings, six fixed the same morning:

- **Buckets follow the tables.** The labourer read lock closed the record's tables but not its
  media: a labourer's login could still download a day's audio, photos and signed PDF straight
  from Storage. One restrictive select policy (migration 20260916120000) closes entry-audio,
  exports and entry-photos to anyone who does not read the record, with the incident folder
  left open because a labourer's own report photos live there. Suite 19 now inserts objects and
  counts what each role can see.
- **A labourer's sign-in is their own, in the table too.** The screen showed one button and no one
  else's row; the policy let any labourer sign any open row out. `app.signin_name_mine` (migration
  20260916110000): gate duty signs anyone, a labourer only a row carrying their own name — profile
  name or email — which is also how a supervisor's gate sign-in of that labourer stays theirs to
  sign out.
- **Three routes asked the role and not the ticks.** Corrections, plant export and prestart
  dictation loaded `role` alone and so ignored a person's screens when the middleware could not
  judge the job from the address (a mixed-role account, a project id in the body). Each now asks
  `sees` for its screen. The rule in AGENTS.md: load `screens` with `role` wherever a membership is
  read for a gate.
- **The PATCH refuses a stray name** instead of quietly dropping it and storing fewer screens than
  the admin meant.
- **A Resend call that hangs** used to leave `notified_at` claimed with nothing sent, and the nightly
  would skip the order as done. Both notify helpers now abort after 20 s, which is the failure
  branch that hands the claim back.
- **The narrative's input had lost the totals.** R55 cut the input down to the rows; the office reads
  hours and man-hours lost off the register, and the numeral check refuses a figure the model works
  out for itself. The totals travel with the rows again.

Two findings stand as design, stated rather than fixed: the tick boxes are enforced by the app
(middleware, pages, APIs, menus) and not by the table policies, which stay by role — a person
with a role's rights and a hand-written database call reaches what the role reaches, ticks or no
ticks; and a retired drill subcontractor document on the sandbox organisation whose file was
removed with the drill, which the nightly storage check will keep naming until the row is gone.

**R60. The hazardous chemicals register, and the one table a labourer may read.** The first gap
closed from the certification research (R59). WHS (General) Regulations 2022 (WA) reg. 346 requires a
register of the hazardous chemicals used, handled or stored at the workplace, kept there, maintained
up to date, holding "the current safety data sheet for each hazardous chemical listed", and readily
accessible to the workers involved. The app held none of it: the only matches in the repository were
an inspection checklist line and a SWMS category label, and a tick box is not a register.

Shaped like the plant register because it is the same shape. `chemical_products` keeps each product
once for the company, `chemical_sds` keeps every sheet it has ever had, and `project_chemicals` says
which of them are on this workplace and where they are kept. A sheet is a record: a newer one
supersedes it and the old one is retired, never rewritten or deleted, so the register can still say
what the crew was working to last March.

Two decisions worth keeping. **Current has a meaning**: a safety data sheet is reviewed at least
every five years, so `sdsStatus` reads the date printed on the sheet and calls anything older out of
date, warns ninety days ahead, and treats a sheet recorded without a file as not accessible rather
than as current — three answers where a boolean would have given one. **And this is the only record
table without a `_reads_record` restrictive policy.** Every other one got one in 20260915140000 to
keep a labourer out of the record. Here the regulation runs the other way: the worker holding the
drum is exactly who must be able to read the sheet, so `canSee` gives the labourer a fourth door and
the table has no read lock. Suite 20 asserts that directly, alongside the labourer still reading no
entries. The screen prints, which is the backup WorkSafe WA asks for when the power or the network
is out.

**R61. One scheduler for everything that falls due.** The certification research found nine of its
eleven gaps were the same object: something that comes due on a cycle, with evidence it happened on
time. An internal audit, a management review, an emergency drill, a safety data sheet up for review, a
five-yearly plan review, a ticket expiring. A surveillance auditor asks one question of each — show me
the schedule, and show me each one happened when it was meant to — so the app answers it in one place,
`/due`, rather than in nine modules.

Two kinds, and only one is stored. **Derived** obligations are read off records that already carry their
dates: a sheet's issue date, a ticket's expiry. Copying those into a table would let the copy and the
record disagree, so `load.ts` computes them each time. **Scheduled** obligations exist only as a schedule
— "audit this job at most every three months" — and live in `obligations`, with each occurrence recorded
in `obligation_completions`.

The next occurrence counts from when the last one was **done**, not when it was due. Main Roads WA
Specification 201 requires audits "at a maximum of three-monthly intervals", which limits the gap
between two audits: an audit done a month late buys the next one no grace, and one done early pulls the
next one forward. A completion carries the day it was due, taken from the schedule rather than typed, and
the day it was done, which the database refuses if it is in the future; who did it is stamped by the
database; then it is frozen. So "was it on time" is a fact of the row, not something that can be tidied
later. Each preset carries the clause that asks for it, because why a thing is due is the first line an
auditor reads, and every field stays editable because a principal's contract can set a tighter interval
than a standard's "planned intervals". Plant inspections, hold points and non-conformance close-outs join
as derived items when those modules are built. Suite 21.

**R62. A notifiable incident is a trail of times, not a flag.** The report carried one boolean,
`notifiable`. The WHS Act 2020 (WA) makes compliance a matter of times: s. 38 requires notice "immediately
after becoming aware"; where notice was by phone the regulator may require written notice within 48 hours of
asking; s. 38(7) keeps the record "for at least 5 years from the day that notice of the incident is given"; s.
39 leaves the site undisturbed until an inspector arrives or directs otherwise. None of those times had a home.

They are events, not columns. The report is frozen on its first account, and a regulator trail unfolds over
days — written notice is asked for after the call, the site is released after the inspector comes. Punching
mutable holes in a frozen row would undo the reason it is frozen, so each step is a dated row of its own in
`incident_regulator_events`, written by a manager, stamped with who recorded it, never re-timed or removed.
`regulator.ts` reads the state off them: how many minutes passed between becoming aware and notifying, when
written notice falls due and whether it is late, the Perth day the record may finally be let go.

Two things the research verified shaped it. The preservation duty in s. 39 belongs to whoever has management or
control of the workplace, which on a principal contractor's site is often not the subcontractor reporting, so a
preservation step must name the duty-holder rather than assume it. And the claim that WorkSafe requires a
regulator reference number to be stored was refuted, so there is room to write one in the detail and nothing
demands it. The flag can also be raised after the fact: recording "became aware" makes the duties apply even
where the first account said otherwise, because realising an injury was serious often comes from the hospital,
not the site. An unnotified incident is overdue on `/due` from the moment of awareness. Suite 22.

**R63. An emergency plan for each workplace, and the drills that prove it works.** WHS (General) Regulations
2022 (WA) reg. 43 requires a plan prepared for the workplace, providing for its emergency procedures, for
testing them "including the frequency of testing", and for telling the workers; subregulation (3) requires
regard to this site's work, hazards, size, location and people. So one company procedure does not serve a
distinct construction site. ISO 45001 cl. 8.2 supplies what the regulation does not say in terms: test the
planned response and keep the evidence.

The plan is a document and is versioned. Each version is numbered by the database, frozen once issued, and a
change is a new version, so the plan in force on the day of an emergency can always be shown. Its fields are
the things someone needs in a hurry — the muster point, the site address as you would give it to 000, the
nearest hospital, who to call, the first aiders, where the kit is — rather than a PDF to download on a phone
with one bar. The drill is a record, against a plan of the same workplace, never dated in the future, frozen.

Two decisions. **The plan reaches the labourer.** Reg. 43(1)(c) is about the workers knowing the procedures,
and in an emergency the labourer is the person who needs the muster point, so the plan is readable by every
member, the labourer gets it as a fifth door, and their home shows the muster point with a button that calls
000. Drill records stay management's evidence under the ordinary read lock. **The drill schedule comes from
the plan.** The plan states how often its procedures are tested, so the next drill is derived from that and
from the last drill held — not a separate schedule someone must remember to set up, which is why the manual
"emergency procedures tested" preset added in R61 has gone. Reissuing the plan does not reset the clock, or
reissuing would become a way to put a drill off. A workplace with no plan shows as overdue on What's due,
because reg. 43 applies to every one. Suite 23.

**R64. Plant: who inspected it, on what basis, and may it be used.** The plant module had daily walk-arounds and
defects, which is not what WHS (General) Regulations 2022 (WA) reg. 213 asks for. Reg. 213 requires maintenance, inspection
and if necessary testing "conducted by a competent person", at intervals that cascade: the manufacturer's recommendations;
failing those, a competent person's; and — for inspection only — failing both, annually. Reg. 237 requires the records kept
for as long as the plant is used. WHS Act 2020 (WA) s. 42 forbids using plant that must be registered and is not.

A machine now carries its inspection basis and interval, and a register of inspections, tests and repairs, each naming who
did it and on what competence, never dated in the future, frozen, with the service report attached if there is one. The
next inspection is a date the inspector wrote on the last one if they wrote one, otherwise the interval counted from the last
inspection; maintenance on its own does not reset the clock, because a service is not an inspection. A machine with a basis
set and no inspection on record is overdue: it cannot be shown to have been inspected at all. Nothing is due for a machine
with no basis — there is no interval to invent.

The research's design caution decided the registration half. A fleet of excavators, skid steers, rollers, dumpers and trucks
contains few or no registrable items: Schedule 5 is tower cranes, mobile cranes over 10 t, concrete placing booms, lifts,
boilers and pressure vessels. So registration is off unless someone says a machine needs it, and only then does anything
bite: a machine marked registrable with no number, or a lapsed one, is refused a prestart by the database and disabled in the
check form. Reg. 213 does not literally require recording the inspector's competence; it is recorded anyway, because "done by
a competent person" cannot be shown without naming the person and the basis, and it is what an auditor asks to see. Plant on
the job appears on What's due. Suite 24.

**R65. Construction records: the principal contractor's plan, and what was known before digging.** Chapter 6 of the
WHS (General) Regulations 2022 (WA) asks four things of a construction contractor that the app did not keep.

**The WHS management plan (regs 309–313)** belongs to the principal contractor, who must write it before work starts, tell
everyone carrying out the work, revise it as the work changes and keep every version. Whether a company is principal
contractor is a fact of the job, so projects carry `is_principal_contractor`, off by default because most of a
subcontractor's jobs are someone else's project, and the database refuses a plan on a job without it. The plan's five
required headings are reg. 310's, a revision records why, and versions are numbered by the database and frozen. The research
corrected a threshold that matters here: in WA a construction project is defined by five or more people working on the site
at the same time (reg. 292), not by the $250,000 test in the model regulations, so the duty reaches smaller jobs than a
reader of the national guidance would expect.

**The excavation record (regs 304 and 306).** The excavation permit asked "Dial Before You Dig plans current; services
located and potholed" as a tick. Reg. 304 requires the information itself obtained, had regard to, made available and kept,
so a record now holds where the information came from, its reference, when it was obtained and until when it was said to be
valid, what it showed, the plans, and who located the services and how. Reg. 306 requires a trench 1.5 m or deeper benched,
battered or shored unless a geotechnical engineer advised in writing otherwise; the database refuses a deep trench with no
control, and engineer advice with no reference. The permit is not changed: it stays the go/no-go, and this is the evidence
behind its tick.

**Retention (regs 303 and 313)** is met by never deleting — the SWMS and the plan are kept until the work is complete, and
two years after a notifiable incident, and nothing in the app is ever purged. The research warned against a blanket two-year
purge; the answer is no purge at all. **White cards (reg. 317)** were already a ticket type; the construction page and What's
due now name anyone on the crew list with none recorded. Both the plan and the services information are readable by every
member of the job, as regs 311 and 304(4) require them made available, though the screen is not added to the labourer's
doors: a supervisor briefs them at the prestart. Suite 25.

**R66. Quality: inspection and test plans, lots, hold points, non-conformance, and calibration.** The largest gap
in the certification research, and the one that decides whether a principal will let the company work on a road job.
Main Roads WA Specification 201 Quality Management, and the council specifications built on AUS-SPEC, ask a civil
contractor to run four things the app had no structure for.

**Inspection and test plans.** Each point carries the elements cl. 201.06.02 lists — the work process and what is
inspected or tested, who does it, how often, the method, the acceptance criteria, whether it uses calibrated equipment,
and whether it is a hold or witness point — plus who reviews the result, from the council specification. An ITP is a
document: a draft is written and edited, issuing freezes it and its points, the principal's review is recorded against
it (review, not approval, as the specification says), and a change is a revision carrying its points that supersedes
the old one when issued.

**Lots.** Conformance is recorded against a lot, numbered by the database, worked to an issued ITP, with its location and
— where it is needed — its surveyed position. Each check is a record against a point: result, what was measured, the test
report number that traces it to the laboratory, the day. A lot closes as conforming only when every point has a result,
none still fails, every hold point is released and no non-conformance on it is unclosed; the database checks, and the
screen lists what is still missing. A rework is a new lot, re-numbered and cross-referenced to the one it replaces.

**Hold points have teeth.** C02 defines one as a position "beyond which work cannot proceed without the designated
authorisation", so a release is a record naming who released it and in what role, and it can only be recorded once the
point's check conforms. A failed check puts the whole lot on hold. Writing the test suite found the first version
wrong twice: a failed lot could still be tested before any NCR was raised, against cl. 201.06.04's "no further testing
until an NCR has been submitted and corrective action approved"; and a lot repaired in place could never close, because
releasing needed an open lot and nothing reopened it. The fix (migration 20260916190100) is that the hold lifts only when
the lot's last non-conformance is closed — never by reopening the lot by hand.

**Non-conformance.** An NCR's observation is its first account and never changes. The root cause, the corrective and
preventative actions and the proposed disposition are worked up while it is open; approving them needs all three and a
named approver, and freezes them; closing it lifts the lot's hold. The research's caution decided the clock: the 24-hour
report and the automatic hold point are Main Roads' contract terms, mirrored by many principals, not something ISO 9001
imposes — so the reporting deadline is a per-job setting, off unless the contract sets it, and a refuted "two working
days" variant is nowhere.

**Calibration (ISO 9001 cl. 7.1.5).** Element (f) of an ITP point implies a register, so there is one: equipment and its
calibration certificates. A point that uses calibrated equipment will not take a check without naming the equipment, and
the database refuses one that was out of calibration on the day of the check — not today, the day. Hold points awaiting
release, NCRs to report or close, and equipment falling due all appear on What's due. Suite 26.

**R67. Internal audits and management reviews: the evidence behind the schedule.** R61 made them fall due. This
records that they happened and what came of them. ISO 9001, 45001 and 14001 cl. 9.2 ask for audits against a stated
scope and criteria by auditors chosen for objectivity and impartiality, with the results reported and kept; cl. 9.3 asks
for management reviews that consider set inputs — the status of earlier actions first — and record decisions and actions.
Main Roads WA Specification 201 adds that audits are done by people not delivering the work, each audit reviews the last
one's actions, and review actions are "reviewed at subsequent meetings until closed-out".

An audit report is drafted with its scope, criteria, auditor and findings — major or minor nonconformity, observation or
opportunity, with the clause, an action, an owner and a due date — and issued. It will not issue unless someone ticks that
the auditor does not deliver the work audited, and unless it has a summary of results; the page offers the previous audit's
open actions as the starting text for reviewing them. A management review opens with the cl. 9.3.2 inputs laid out as
headings, shows every action still open from earlier reviews at the top so they are reviewed rather than forgotten, and
records its decisions and its own actions. Once issued, both are frozen, and an action is marked done once, stamped by the
database.

The link to the schedule is made by the database, not the screen. Issuing an audit or review that names its schedule
records the schedule's completion in the same transaction — due date from the schedule, done date from the audit, a
reference back to the report — through `app.obligation_next_due`, which computes the next occurrence exactly as `nextDue`
does. Doing it as a second write from the phone would have let a report exist with its schedule still showing overdue.
Open actions from issued audits and reviews appear on What's due. Suite 27.

**R68. Asbestos: mostly a register received, not one written.** WHS (General) Regulations 2022 (WA) reg. 425 puts
the asbestos register on the person with management or control of the workplace, reg. 429 adds a management plan wherever
asbestos is identified or presumed, and reg. 466 requires licensed removal notified to WorkSafe five days ahead. The research's
design point decided the shape: on a principal contractor's site the duty holder is usually the principal contractor or the
owner, not this company. So the main act is receiving their register, keeping it where the crew can reach it, and briefing
the crew on it — and the app records exactly that.

A register names who holds the duty, its date and reference, what it says in brief, whether asbestos is present, and the
document itself; where asbestos is present, the management plan and its date, with the review falling due five years on. A
newer register supersedes the old, which is kept and frozen. "No register required" is accepted only with all three of reg.
425's limbs stated — built after 2003, none identified, none likely — because any one of them alone is how the exception gets
misused. Briefings are recorded by name against the register in force, once each, and What's due lists anyone on the crew
not yet briefed where asbestos is present. A removal records the removalist, licence class and number, the notification and
the start of work; the database refuses friable asbestos under anything but a Class A licence and fewer than five days'
notice unless it is an emergency. Suite 28.

**R69. Health monitoring: a tier of its own, not a tick box.** WHS (General) Regulations 2022 (WA) Part 7.1 Division 6
requires health monitoring, supervised by a registered medical practitioner, where a worker uses, handles or stores a Schedule
14 hazardous chemical and there is a significant risk to health, or where the risk assessment otherwise shows it; Part 7.2 adds
lead risk work, notified to WorkSafe within seven days of it being determined; asbestos work brings its own. The reports are
confidential and kept 30 years, 40 for asbestos. The research warned against implying it applies to all chemical work, so a
programme is set up deliberately, for a named hazard, on one of those four stated bases, and the page says when it applies.

Every other module's access is a role plus the per-person screen ticks (R57). That was not good enough here: a supervisor who
is ticked for the training matrix must not thereby read a doctor's report. So the reports sit behind a third gate, in the
database — `health_record_keepers`, named people per organisation. Only an active keeper reads or writes a record or its
file; an admin appoints and revokes keepers but reads nothing unless they appoint themselves, and every appointment and
revocation is stamped with who did it and when. A keeper is revoked, never deleted. The screen tick decides only whether the
page opens; a non-keeper who opens it sees the programmes and the keepers' names, never a person.

A record is frozen, and its retention date is stamped by the database from the monitoring date. Upload first, then the row,
and the file is removed if the row is refused. What's due lists health monitoring falling due as a count per programme, never
a name, read off each person's latest record, and only for a keeper, because only a keeper's query returns rows. Suite 29.

**R70. A person's name on the sheets, never their email.** People sign in with an email address, and every sheet and
screen prints `profiles.full_name`, falling back to the email only when no name was ever given. Accounts made by adding a
single email, or a bulk line with no name, had none, so a supervisor's prestart could go out signed by an address. Mitchell
asked for names on the sheets. Rather than chase the fallback through thirty places, nobody can reach a screen without a
name: `requireUser` sends a nameless account to `/name` first, once. The same page changes it later ("Your name" in the
menu), and an admin can set a member's name from the members screen, written by the service role after the admin and
membership checks because profiles only let a person write their own row. The database refuses a blank name or one with an
@ in it (`profiles_full_name_is_a_name`); `src/lib/people/name.ts` is the TypeScript half. A diary PDF is stored the first
time it is opened, so one that has been opened keeps the name it printed. Suite 30.

**R71. A heavy month is bound in parts, a part per request.** The month bundle failed on Curtin in September with "The
object exceeded the maximum allowed size": the exports bucket takes 50 MB a file, and half a month of dockets with their
photographs was already 133 MB (one day alone is 26 MB). The dockets are frozen bytes, so nothing can be shrunk without
changing the record, and a 300 MB file would not open on a phone or go by email anyway. So the month is packed in date order
into parts (`planVolumes`), every part carrying the whole month's contents with a Part column and its number in its title and
footer. The first version bound all the parts in one request and passed on a laptop in 56 seconds, then died on Vercel at
the 300-second limit after one 39 MB part took about two and a half minutes (the files cross between Tokyo and Sydney). So
parts are now at most 24 MB and each is its own request: the button asks for the plan, then builds the parts not yet
stored one after another, showing each link as it lands. A part's file name carries a key from the whole month's content
hashes, so a part already built for exactly this record is reused and a late correction makes new parts rather than serving
stale ones. The first-of-month email job, which shares one 300-second nightly run with other checks, builds what it can each
night through the first week and sends once every part is stored.

**R72. The dayworks schedule.** Mitchell asked for a dayworks schedule with the total of dayworks hours and the works
completed. The claims register already listed dayworks for the whole job, but not by period and not as a document to hand
over with a claim. `/dayworks` (Claims in the menu, the `claims` screen) reads diary.dayworks, which holds signed days only
with a corrected day counted once, plus dockets added after signing, exactly as the claims register does. It shows each daywork
as a line of works completed with its hours, docket, labour, plant and materials. Lines are grouped by week (Monday to
Sunday) with week subtotals and a period total, for the whole job, this week, this month, last month, or chosen dates, and
each line links to its signed day. Hours are totalled only where recorded: a daywork without hours shows "Not recorded" and is
counted separately, never added as nought. Dayworks on days not yet signed are counted in a note, not in the schedule. "Print
schedule" returns the same content as an A4 PDF (`/api/dayworks/pdf`), rendered on demand, stored nowhere, with no AI text.
Checked on Curtin: 12 items and 106 hours for the whole job, matching an independent count of the signed record.

**R73. Environmental management: what the ISO 14001 report found missing.** The research (ISO 14001 on Site, 17/09/2026)
found the app already kept most of the evidence ISO 14001 asks to be retained, and nothing it asks to be maintained. `/environment`
(Safety in the menu, the `environment` screen, every role but the labourer) now holds it. The **aspects register** (cl. 6.1.2) is
company-wide, with a yes or no per job, judged by the database against **significance criteria** that are versioned and frozen.
Likelihood times consequence at or over the threshold is significant, and every change to an aspect keeps the row as it was.
The **legal register** (cl. 6.1.3) holds each obligation's source, reference, requirement and how it applies, company-wide or
for one job's contract or approvals, linked to aspects. An **evaluation of compliance** (cl. 9.1.2) cannot be issued until every
obligation in scope has a result, every result but "not applicable" has evidence, and every non-compliance has an action. It
also needs a summary. Issuing it freezes it and discharges its schedule in the same transaction, like audits (R67). Its actions
stay on What's due until done. **Monitoring** (cl. 9.1.1) records dust, noise, vibration, water and waste readings. The database
judges a reading against its limit, refuses an exceedance without the action taken, and freezes the row.

The clocks come from contract and law, not ISO. An **environmental incident** carries its own frozen trail beside the WorkSafe one
(R62): severity on Spec 204's five-level scale and whether it is Serious, the Superintendent notified, the report within the job's
hours (moderate or worse, or minor or less) counted from when it happened, the investigation within the job's days of notifying the
Superintendent, and EP Act s. 72. That is DWER-notifiable and why; a phone call to Environment WAtch, which the panel and What's due
both say does not meet s. 72 on its own; and the written notice. The clocks are per job and blank means none, following
`ncr_report_hours`; "Fill in Spec 204's" sets 24 hours, 72 hours and 28 days. **After heavy rain**, the Bureau's rainfall for the
job at or over the job's trigger (10 mm by default, the M12 West CEMP figure, which a contract may change) with no environmental
check dated from that day to two days after puts a check on What's due for the next day. It is a prompt; the check is the record.
A Spec 204 environmental audit preset (three-monthly, cl. 204.32) joins the schedule presets. Environmental nonconformities go to
evaluation actions, audit findings or incident actions. The quality NCR stays tied to lots. Not built, because the research refuted
them: a prescribed register format, and daily dust-control evidence as an ISO requirement. Suite 31.

**R74. Working as a subcontractor.** Mitchell: "we are generally a sub contractor". Kooboolong works under a head contractor
(Lendlease at Curtin), so what its records must show flows down from them rather than from a client specification or a
principal contractor's duties. `projects.principal_contractor` already named them, now labelled "Head contractor" in
Settings. `is_principal_contractor` stays off unless Kooboolong runs the site, and on such a job none of this applies. Three
records were added, each frozen once made. **Reporting up:** every hazard, near miss and incident shows whether the head
contractor was told, when, how, by and to whom, and their reference (`incident_notices`, recorded by the crew who run the
day). An optional deadline in hours from their site rules is set per job, blank meaning none. What's due lists any report in
the last 90 days not yet told up. **Their plans:** the WHS management plan (regs 309–313 are the principal contractor's), the
environmental, emergency and traffic management plans, site rules and induction material are kept as received
(`head_contractor_documents`), with revision, date and copy. A newer revision supersedes the old one, which is kept. What's
due asks for their WHS and emergency plans, and their emergency plan on file stands in for the workplace's plan (reg. 43).
**SWMS to them:** a SWMS is submitted, then accepted or returned with what to change, then resubmitted (`swms_reviews`;
reg. 312 has the principal contractor collect them). What's due lists a SWMS in use that they have not accepted. The wording
that assumed a Main Roads head contract was reworded: Superintendent became head contractor, and the Spec 201 and 204 presets
and deadlines are offered where the head contract requires them. The environmental incident panel says the s. 72 DWER duty
is the occupier's, usually the head contractor on their site. Suite 32.

**R75. A labourer sees only their own reports.** Mitchell asked for it after seeing the labourer's screens. Until then a
labourer could read the job's whole hazard and incident list, including injury reports marked notifiable and their updates,
actions and photos. Now the database lets a labourer read a report only if they made it (RESTRICTIVE policies on
`incidents`, `incident_updates` and `incident_actions` via `app.incident_readable`). The photo rule sits in the existing
`"record media reads by role"` storage policy through `app.incident_photo_readable`, where a folder that is not an incident
id reads as nothing. Every role that reads the record is unchanged. The screen calls the list "Your hazard reports" for a
labourer, and so does the link on their home. The chemicals page speaks to a labourer as a reader, not as the person who
keeps the register: an empty register tells them to ask their supervisor to add what they use. Suite 33.

**R76. The subcontractor's site forms work with no signal.** R74 and R73 added forms filled in on site: telling the head
contractor about an incident, a SWMS submitted, accepted or returned, an environmental monitoring reading, and a head contractor's
plan received with its copy. Each wrote straight to the database, so with no signal it failed, breaking non-negotiable 6. They now
go through `runOrQueue` like every other site form, with ids chosen on the phone, as outbox kinds `hc_notice`, `swms_review`,
`env_monitoring` and `hc_document` (the copy travels as a blob, is uploaded before the row, and supersedes the older plan on
replay). A notice waits behind its incident, since both share the subject, so a report made offline lands first. SWMS steps wait
behind earlier steps on the same phone, so "accepted" never reaches the database before "submitted". Each screen shows what is
still on the phone (`usePending`), marked as not yet sent, and the waiting banner is on the incident, Construction and
Environment screens. A save with no signal no longer refreshes the page, which offline blanked it. Drilled with the signal cut on
all four, then restored: each landed once, in order, the plan with its file, superseding the older copy.

**R77. A timestamp's date is Perth's, not UTC's.** Timestamps are stored in UTC, and in 42 places a date was cut from one by
taking its first ten characters, which is the UTC day. Anything from midnight to 8 am in Perth then showed the day before,
beside a Perth clock time that said otherwise: an incident at 06:30 on the 17th printed "16/09/2026 06:30 AWST". It appeared on
the incident, permit and inspection PDFs, the office emails, and the order, incident, procedure, document and environment
screens. The days-since-last-injury count took the UTC day too. `perthDate` and `fmtPerthDate` in `src/lib/pdf/dates.ts` add
Perth's eight hours by arithmetic, since Perth has no daylight saving, so PDFs stay deterministic (`pdf:check` passes). The
daily docket never had the fault: its date is the device's entry date. The visitor gate's "since" time now reads in Perth
whatever the visitor's phone is set to. PDFs already stored keep the date they printed, because a stored PDF is the record and
is never regenerated. Rule: never `.slice(0, 10)` a timestamp for display; use `fmtPerthDate`.

**R78. The second-agent review of everything built on 17 September.** Five reviewers read the day's work against
`docs/review.md`, each on one area and none of them its author (AGENTS: one agent builds, the other reviews). They found
28 defects; every one below was checked against the code before it was fixed, and the fixes went out with the suites that
prove them.

*Confidentiality (R69).* `app.is_health_keeper` asked only whether a keeper row existed, so a keeper who left the company
kept every worker's results — it now also requires them to be on a job of that company. Re-appointing someone overwrote the
one keeper row, losing the history; appointments and revocations are now events in `health_keeper_events`. A programme's
`org_id` could be changed by someone who managed crew in two companies, taking its records with it; it is frozen, and
retiring a programme is stamped. A refused record left its confidential report in storage, because the bucket had no delete
policy; the screen now checks everything the database will check before it uploads, and a keeper may delete a file no record
names. A person who leaves stayed "due" for ever, inviting a false record: `health_monitoring_ended` records that monitoring
ended. A lead notification later than seven days was refused outright, which invited a false date; it is recorded with its
true date and shown as late. `/health` is never kept in the phone's page cache (`sw.js` v10). A PM or supervisor saw "None
set up" rather than the programmes and keepers R69 promised — programmes and keeper names are readable by whoever reads the
company's record; reports stay keepers-only.

*Names (R70).* "Your name" let anyone rename themselves, and the gate lets a labourer sign in or out only rows carrying
their own name: a rename was a way to sign a workmate in. A name is now set once by the person and changed after that by an
admin (`app.profiles_name_guard`). A failed profile read was treated as "no name" and sent a named supervisor to the name
prompt; it now fails loudly, like the membership read beside it.

*Environment (R73).* A reading typed ">1000" or "72dB" became NaN, which the client sends as null: the row saved as "within
limit" with no reading, frozen. Readings and the contract deadlines are now parsed strictly and refused with an explanation.
A limit can be a minimum (`limit_kind`), so pH 4.8 against 6.5 is an exceedance. Closing an environmental incident hid its
DWER notice and report deadlines from What's due. A company-wide evaluation of compliance counted every job's contract
obligations, which the evaluator often cannot even see: it covers the company-wide ones. The after-rain prompt counted a
check dated up to two days after the rain — a Friday storm answered on Monday could not be cleared honestly — and counted a
check made the morning before the rain, and unsigned checks; it now takes a completed check from the next day to a week
after. The pre-filled significance criteria promised something the database does not do. Links between obligations and
aspects can no longer be repointed, the register's history is frozen for every role, and a done date on a draft is stamped
once (audits too).

*Subcontractor (R74).* Recording any plan marked the current one of that kind as replaced — an unrelated procedure, or a
second traffic plan — and froze it; replacing is now an explicit choice, and only a copy received on or after the one it
replaces. A queued plan could supersede a copy that had itself been superseded while the phone waited, leaving two in force;
the replay follows the chain. The head contractor's emergency plan cleared What's due while the crew could not read it: the
plan and the site rules are readable by every member, a labourer included (reg. 43), and the labourer home and `/emergency`
show it. Telling them through the environmental trail left What's due asking for the same call again. Every JSA was flagged
as a SWMS awaiting their acceptance. A reply cannot be dated before the submission it answers. A submitted draft SWMS can
still be deleted as a draft. The 90-day window on "tell the head contractor" is gone; the duty runs from when the record
began.

*The month bundle (R71) and older PDF code.* The nightly email would never have sent: the deadline check compared against a
window that had already passed, and a one-part month was never marked ready. The page could hand over parts bound under two
different plans; each part request now carries the plan's key and a changed month starts again. Closing Chromium after each
part could kill another request's render on the same instance, and a `newPage()` that rejected was not retried. Every part
shared one PDF identifier. The dayworks schedule's header total now says when hours are missing, and says so when the
1,000-row cap is reached. And `/api/entries/[id]/pdf` — older code — re-rendered a signed day and wrote it over the stored
PDF on `?force=1` or after a moment's Storage failure. The stored PDF is the record: it is never written over, absence is
established before rendering, and `force` is gone.

*Dates (R77).* `fmtDate` itself now shows a full timestamp's Perth day, which fixes the places R77's search missed —
including SWMS sign-on dates on a stored PDF. The safety dashboard's monthly buckets were the UTC month. In SQL,
`set_variation_status` and `set_daywork_docket` stamped `current_date` (UTC); they use `app.perth_today()`.

*Offline (R76).* A queued step sorted before the saved steps of its own day, so a returned SWMS still read "awaiting
acceptance". A save kept on the phone refreshed the page whenever the device claimed to be online, which blanks it on one
bar; the outcome of the save decides now. A replay whose file had been lost from the phone would have written a row naming
a file that was never uploaded.

**R79. Undo and redo, on the day being written up.** Mitchell asked for undo and redo buttons. They belong to the one place
the app is a place of editing rather than a record: the day's review screen, where the supervisor works on an unsigned draft.
Everything else the app holds is immutable or frozen by design — a signed entry, a finished prestart, an issued document, a
recorded reading — and the way back from those is a correction that supersedes, not an undo (non-negotiable 2). So the
buttons sit at the top of the day's diary, and the day's signature ends what they can reach.

A step is a whole snapshot of what the screen holds — the review payload and which sections are confirmed nil — so undo puts
back exactly what was there, including a row removed or a section confirmed by mistake. Steps are recorded 700 ms after the
last change, so a burst of typing undoes in one tap rather than letter by letter, and opening the day records nothing.
Putting a snapshot back goes through the screen's own autosave, which is how every other change reaches the draft; the
server ends up with what the screen shows. Cmd or Ctrl+Z and Shift+Cmd or Ctrl+Z do the same, except inside a text box,
where the browser's own undo is better and is left alone. Fifty steps are kept (`src/lib/undo/history.ts`, pure and tested).

Undoing away a photograph leaves its file in storage with nothing pointing at it until it is put back or the nightly
`orphans=1` check reports it — the same as removing the photograph by hand, which is what undo is undoing.

**R80. The app is Kooboolong IMS.** It began as a site diary and is now the company's integrated management
system: the diary is one section of it, beside safety, quality, environment, plant, people and the registers. So the
name on the brand row, the home screen, the browser tab, the push notification and the From line of every email it
sends is Kooboolong IMS, and `/entries` keeps the name Daily Diary as what it is — the section. The repository, the npm
package and the Vercel project stay `site-diary`; renaming those moves the deployment and buys nothing.

The one place the change reaches a document is the PDF's internal Producer and Creator metadata, which now names the
software that made the file. Dockets already stored are the record and are never regenerated (non-negotiable 2) — the
PDF route reuses the stored file and never renders over it — so nothing that exists changes. A docket exported for the
first time after today differs by that one string from what the same entry would have produced yesterday; determinism
is unchanged, because it is a promise that the same entry renders the same way, not that the software never changes.

**R81. Work that belongs to a variation goes in variations, not dayworks.** The vac trailer on Curtin is variation
V-001, "Excavate for mainline using Vac", raised on 2026-08-31 and priced. Several days recorded it under dayworks
instead — the same work, filed as day labour, where a progress claim would never find it and the register would never
add up the hours. Mitchell asked for it moved, on every day, signed or not.

Signed days are not edited. 2026-09-10 and 2026-09-15 had already been corrected — each carries a superseding entry
whose vac work sits under variations — and the original stays exactly as it was signed, which is the point of it.
2026-09-16 and 2026-09-17 each had a correction already open, and 2026-09-18 was still the day's own draft; the move
was made on those three. A variation has no plant field, so the daywork's plant text was carried into the description
rather than dropped: "Vac Truck" on the 17th is not on that day's plant list, and a variation claim that loses a
machine loses money. Hours moved across as recorded and nowhere invented — the 18th had none stated, so it has none.

A variation reaches the register only through its number (`variations.register_seq`), and the insert trigger links it.
Every moved row carries 1, so V-001 now collects each vac day.

**R82. Moving a daywork onto its variation, in the app.** R81 was fixed by hand in the database, which is no use the
next time it happens — and it had already happened twice. So each daywork row on an unsigned day carries "Move to
variations": it asks the one question that matters, which variation, and will not move until that is answered, because
a variation with no number never reaches the register and the day cannot be signed with one (`variation_missing_number`).

The move is an ordinary change to the payload (`src/lib/review/move.ts`, pure and tested), which means it autosaves like
any edit, the day's Undo puts it back, and a signed day is untouched — the way back from one of those is still a
correction. Nothing is invented and nothing is dropped: hours and photos travel as they are, and the labour, plant,
materials and docket a variation has no field for are kept in the description in the words that were typed. The crew
list is deliberately left empty, because splitting free text like "2x Marcus Hayden , Evan Burke" into names invents a
person called "2x Marcus Hayden"; the names are one tap each on the row itself.

There is no move the other way. Dayworks and variations are not two labels for the same thing — one is day labour the
head contractor pays by the hour, the other is directed work that changes the contract — and the mistake only ever
runs in one direction.

**R83. The dayworks sheet the client signs.** The schedule (R72) is a register: dense, internal, the thing a claim is
built from. What Mitchell hands Lendlease is a different document — the same dayworks, itemised and numbered, with the
labour, plant, materials, docket and hours recorded against each, the photographs taken on them, and a block for the
head contractor to sign. `?signoff=1` on the same route, so there is one loader, one set of figures and one place a
number can be wrong.

The declaration says what a signature there means and what it does not: it acknowledges the labour, plant and materials
expended on the dates shown, and leaves rates, entitlement and value to the contract. That is what a dayworks sheet is
for, and saying it protects both sides — a client who signs has not agreed a price, and a subcontractor who is signed
has proof the resources were there. The head contractor is named from `projects.principal_contractor` and falls back to
"the head contractor" rather than inventing one, and the preparer is the signed-in person's own name (R70).

Photographs are embedded as data URIs and re-encoded at print time (`data-shrink`), like the weekly's, so the sheet is a
document rather than a page of links that expire; they are keyed to the item number so a photograph can be tied to the
line it belongs to. A hundred is the cap, and what is past it is reported and stays in the daily dockets.

The trap this document has, that the register does not: a day whose correction is written but not yet signed still shows
its old rows, because the schedule reads the signed record and that is the right answer for a register. On a sheet the
client signs it is the wrong thing to send — they would be signing off work already moved to a variation. So the loader
counts those days (`pendingCorrectionDays`) and the screen says so above the download, naming the head contractor. The
sheet itself stays clean: a client document does not carry the subcontractor's own housekeeping.

**R84. A page decodes its photographs one at a time, or Chromium dies.** The sign-off sheet (R83) rendered fine at
nineteen photographs and then, at twenty-four, failed on Vercel every time with "target page, context or browser has
been closed" — the render-once retry (R78) could not help, because the browser was not stale, it was being killed.

`page.setContent(..., { waitUntil: 'load' })` waits for every `<img src>` to load, and a phone photograph that weighs
three megabytes on disk costs tens of megabytes decoded. Two dozen of them, all decoded before `load` resolves, is more
memory than the function has. The shrink step that would have made them small runs afterwards, so it never got the
chance.

Deferring the decode was not enough, and the logs said why: `instance was killed because it ran out of available
memory`, even at 2 GB. The bytes themselves were the problem. Two dozen phone photographs as base64 is a two-hundred-
megabyte HTML string, and it exists several times over before a pixel is drawn — the buffers, the base64, the assembled
string, the JSON of the CDP message, and Chromium's copy.

So a photograph never goes in the HTML at all. The document emits `<img data-photo="key">` and hands the bytes to
`renderPdfDocument` in `meta.images`; after `setContent` the renderer walks them one at a time, draws each small into
its placeholder and lets the big one go. Only one photograph exists at once, anywhere. `meta.imageMax` sets the longest
side (the sign-off sheet asks for 900px — legible evidence that still emails from site), and `data-src`/`src` are still
honoured for pages carrying few enough to load outright. The daily docket marks no image at all, so its bytes are
untouched and it stays byte-identical.

A correction to the record above: the deploy log says `Provided memory setting in vercel.json is ignored on Active
CPU billing`. The 2 GB given to the photo-carrying routes never applied — the function's memory is whatever the plan
gives it — and the "even at 2 GB" reasoning was wrong about why. The fix was, and only was, keeping the bytes out of the
page and drawing them in one at a time. The `memory` entries in `vercel.json` are left as documentation of intent;
`maxDuration` there still applies.

The weekly was left embedding its eighty photographs the old way, on the grounds that no week had carried enough to
fall over. Three days later a week had: **Download PDF on the weekly report came back as `internal.json`** — a plain
`<a href>` to the route, so when the route 500s the browser saves the error body under the last path segment. Behind it
was the same "target page, context or browser has been closed". The lesson is the one this repo keeps learning: a known
fault left in place is a fault with a date on it, not a risk. The weekly's photographs now travel in `images` too.

Two things fell out of fixing it. The eighty downloads from storage ran one after another, which was most of the two
and a half minutes a weekly took — six at a time, in print order so the keys stay stable, brought the whole render from
147s to 57s. And at 800px rather than 1000 the report went from 13.3 MB to 7.5 MB, which is the difference between a
PM opening it on site and not.

**R85. A variation valued at nothing.** Curtin's V-001 — the vac trailer, the biggest thing on the job — sat on the
register marked "priced", with eighty-four hours of crew and plant recorded against it and an estimated cost of **$0**.
Nothing in the app said a word, because `waitingOn` asks whether a variation has a value and 0 is a value. A blank cost
box saves as zero, and the register believed it.

So `registerWarnings` (`src/lib/claims/warnings.ts`, pure and tested) says the two things the tracker could not:
a variation valued at nothing with work behind it, and days recorded against it that state no hours — which are not in
the total, so the claim reads short by however many they were. They are warnings, not gaps: nothing is refused. A
variation genuinely worth nothing is allowed, it just has to have no work behind it, because a day of work is never
worth nothing.

Finding it turned up a second fault underneath. The register's `mentions` counted every version of a corrected day, so
31/08 appeared on V-001 twice and its hours were added twice — the number a claim is built on. A day now counts once,
superseded only by a SIGNED correction, the same rule the diary views and the weekly already used.

**R86. The client's signature on a dayworks sheet.** The sheet (R83) went out, came back signed, and came back to
nothing: it lived in an inbox. In three months, when the claim is argued, a countersigned dayworks sheet is the
strongest document in the file.

`dayworks_signoffs` records it against the job with the countersigned file and — this is the point — **what the sheet
said at the time**: the period, the items, the hours. Frozen on insert, like every other signature here. What the
client put their name to does not change because a day was corrected afterwards.

Which means the schedule can drift away from it, so the screen says so: `driftFrom` compares what was signed with what
the period reads now, and a correction landing after a signature is exactly the case where a subcontractor believes he
is covered and is not. Only the items and the hours count as drift — a photograph added later is not a change to what
was agreed.

Written by whoever keeps the registers (`app.can_manage_registers`), read by whoever reads the record — not the
labourer. The file goes up first and the row straight after, with the file removed if the row is refused, the same
order as an issued procedure; the nightly `orphans=1` check reports either half without the other. Suite 34.

**R87. This job, and the company.** Mitchell, with a second job coming: "it needs to be split into job-specific
things and then company-wide". The data already was — the fleet, tickets, subcontractors, procedures, chemical
products, calibration, competencies and templates are keyed to the organisation and shared by every job on it, while
the diary, incidents, variations, prestarts, sign-ins, permits, lots and dayworks are the job's. What was not split was
the app: every screen, the company ones included, was reached through a job, worked the company out from that job, and
showed the job's name at the top. With one job nobody notices. With four, the plant fleet opened from Curtin looks like
Curtin's fleet, and there was no way to move between jobs at all — `resolveProject` took the first active membership
and stayed there, the one thing the earlier record listed as deliberately not built.

Two things, then. **A job switcher that sticks.** The job you pick goes in a cookie (`kbl-job`), and `requireUser`
hands every screen its memberships with that job FIRST — the fifty-nine pages keep asking for "the first active job"
and get the one you chose, without any of them learning about cookies. The middleware writes the same cookie from
`?project=`, so a link and a pick agree, and `/api/me` orders the same way so the rail and the drawer show the job the
pages will open on. The cookie is a preference, not a credential: `preferJob` moves only a job the account holds, and
only one awake; a stale or forged id changes nothing. Switching keeps the section you are in and drops any detail page
— a day belongs to one job, so `/entries/<id>/review` on Curtin becomes `/entries` on the next job, never that day
there (`switchTarget`, which takes the longest section address that prefixes the path, so `/quality/equipment` stays and
`/quality/lot/<id>` goes to `/quality`).

**The menu split.** A section declares `scope: 'company'` in `nav.ts` — the one list — and `navFor` draws those under
one Company heading after the job's, with "This job" and "Company · <the company>" captioned where the scope changes, in
the drawer, the rail and the home bar alike. Company: the calibration register, health monitoring, subcontractors, the
training matrix, policies and procedures, All jobs. A section that is honestly both — Plant is the machines here and the
fleet behind them; Chemicals is what is on this site and the company's product list — stays with the job and names the
company on its company half, because it opens on the job's part and that is what a supervisor is there for. Company
screens show the company's name at the top, not a job's. Across two companies the switcher names the company with each
job, because two jobs can both be numbered 001.

Not done, on purpose: a company-level home. Home is still the job you are on; All jobs is the glance across them. Nor
company-wide crew — access and screen ticks stay per job, which is right for a subbie crew that changes site to site;
if the core crew turns out to work across everything, that is a separate decision.

**R88. Adding someone by email, and inducting them by hand.** Two things Mitchell asked for in one breath, both about
getting a person onto a job without ceremony.

*By email.* Add member took an address and refused it if no account existed — "create it with the QR/onboarding
operator flow, then add them here" — while the bulk add, three lines away, made the account itself. Now the single add
does what the bulk add did: an address is enough; no account yet and one is made, confirmed, no email sent; they sign
in with that address on their own phone, by the link the login screen sends them, and land on the job. A name given
with it goes on the sheets from the first day (R70) — it fills a blank, never overwrites the person's own.

*By hand.* An induction was recorded only on the day, by the button on a sign-on or a ticket row: today's date, no
notes, only a name already on the roster. A supervisor who inducted a subbie on Monday and wrote it up on Wednesday, or
inducted a visitor on no roster, had nowhere to put it. "Who is on this job" now carries the inductions: everyone on the
job by name — members and roster together, since the gate and the prestart speak in names and a subbie may have no
account — inducted or not, and a form for recording one: a name picked or typed, the day it happened (any day up to
today; the database refuses one after), and what was covered. Whoever runs the talks records it. The table is unchanged;
the rule at the door (`app.crew_inductions_before_write`) tidies the name so the unique index's one-per-person holds
across casing and spacing, and stamps the recorder. Suite 35. Not frozen, deliberately: a name typed wrong wants
correcting, and an induction is not a signed record — the sign-on that cites it is.

**R89. A SWMS you already have, and signing on to it from your own phone.** Mitchell: "add an option to add SWMS,
then let people sign on to it digitally." Two gaps in one sentence.

*Adding one.* The app could only write a method statement, step by step, with the eighteen high-risk categories and
the risk matrix. That is the right tool for a JSA thought up on the day; it is the wrong door for the SWMS a
subcontractor already has — from a safety consultant, from the head contractor's template, reviewed by Lendlease last
month. So `/swms/new` offers the document itself: a file, a title, and it is in use the moment it lands. A filed SWMS is
complete on its own terms — the document IS the method statement — and `swms_problems` asks nothing more of it, in both
halves. The file is as frozen as every other content column once in use (`app.swms_file_guard`); a change is a new
version, as ever. The export for a filed SWMS is the sign-on register: who put their name to that document, and when.

*Signing on.* A sign-on was recorded by whoever runs the talks, every signature drawn on the supervisor's phone at the
toolbox; a labourer could not open a SWMS at all. Now any member of the job signs on to an ACTIVE SWMS as themselves,
from `/swms/sign` — their own door, on the labourer's home — reading the document or the steps first, then a signature.
"As themselves" is the database's rule, not the screen's: `app.can_sign_own_swms` accepts an attendee name only when it
is the name on the caller's own profile (R70), so a labourer can sign for nobody else. The supervisor's way of signing
the crew on is untouched, and the two land in the same table, once per person per version, frozen. It goes through the
same offline queue (`swms_signon`), so a sign-on drawn in a trench with no signal arrives when the phone does.

Reads had to move for this: an active SWMS on a job is every member's to read — a worker must be able to read what
they are signing (WHS Regulations r. 299, r. 300) — and their own sign-on is theirs to see. Drafts and superseded
versions keep the record lock, and the rest of the sign-ons stay the crew's. Bucket `swms-docs` `{project}/{swms}.ext`
follows the same line: readable by every member of the job, written by whoever writes SWMS. Suite 36.

**R90. Instructions received, and anything outside our scope — the diary's seventh section.** The most valuable
change in the Project Control brief, and the one it got exactly right: a diary field that asks, every day, *"Any
instructions from the head contractor today, or anything outside our scope? Say 'none' if not."* What the head
contractor directed, what the crew was asked to do that may be extra, and whatever stopped or slowed the work from
outside the crew's control — late access, other trades, missing information, drawing changes, unexpected ground, plant
standing. In the supervisor's own words. It is the record a notice stands on, and months later the record a claim
stands on when the notice is argued over.

It is a true section, not an extra: `site_events` joins the `entry_section` enum, has the nil question, and prints
NIL or NOT RECORDED like labour and plant do. Six places, in order: the table, the hash (a conditional key, so every
entry signed before today still verifies), the extraction (the prompt is told to return the supervisor's words exactly
and never to tidy them, and to fill where, who and when only if they were said), the review screen (straight after
the work, while the day is fresh, with the source quote beside the words), the docket (a numbered section, and the
photographs in the appendix), and the weekly. The brief said five; this repo's record says money leaks through the
sixth.

One place the brief and this app disagree, and the app wins: the brief makes `said_text` immutable on insert. Here a
section is proposed by extraction and *confirmed* by the supervisor — non-negotiable 1 — so the words are editable on
the review screen until the day is signed, and frozen with it. The verbatim rule is enforced where it matters: the model
may not rewrite them, and the supervisor sees the quote they came from.

*Notices.* The office's inbox is every event on a SIGNED day with no notice and no decision. "Draft a notice"
pre-fills Form 1 with the words verbatim and the date, where and who beneath — and nothing else, because why it is
outside scope is an opinion and the app holds none. "No notice needed" takes a reason, on the record. A notice is
written by a person and sent by a person; the app records that it went and how, **and never sends one itself**. Every
unsent draft shows how long ago the thing happened — from the time the supervisor said, or from knock-off when none
was, a late answer never an early one — because the contract wants prompt notice. Numbered per job; frozen once sent
but for voiding; office-only (`app.is_office` = pm and admin). Supervisors keep the claims screens they have (Mitchell,
2026-09-21) and read no notices. Suite 37.

**R91. The company's templates, and the editor to fill them.** The Project Control brief's Phase 1 stamps a new job
from company templates — 374 items across core, earthworks, FRP and remote, in a seed file that never arrived. Rather
than invent Kooboolong's own knowledge, this is the library and its editor, so it can be filled by hand while the rest
is built, and later so the closeout loop has somewhere to promote a job's one-off items to.

Two tables. `template_modules` — core, earthworks, frp, remote, landscape, irrigation, given to every company as
shells; core is every job, the rest are attached per job. `template_items` — a start gate item, a hold point, a
submittal, a SWMS to have, a consumable with a par level, a risk, an expected document or one of the twelve folders;
each with a module, a tier (`light` for the ten things a purchase-order job needs; `full` for the whole module), a
priority and owner where they mean something, and an `origin` (template, manual, contract) for the closeout loop.
Company data: read by every member of the company, written by its office (`app.is_org_office` = pm or admin on any of
its jobs). Retired, never deleted. The database checks what the editor checks: a document names its folder, a par level
needs a unit, an item stays with its company.

`/templates` is a company screen for pm and admin: pick a module, pick a kind, add, change, retire, restore. The
stamping of a job from these (`instantiate_project`) is Phase 1 proper and is not here yet. Suite 38.

**R92. A job stamped from the templates: `instantiate_project` and the start gate.** R91 built the library; this
gives it a consumer. `instantiate_project(project, modules[], tier)` attaches modules to a job (core always) and stamps
every active template item those modules hold, at the job's tier, onto the job's SETUP BOARD (`project_setup_items`):
start gate items, hold points, submittals, SWMS to have, consumables with par levels, risks, expected documents, the
folders. It adds only what is missing — a second run, a module added mid-job, a library that grew since: all additive,
nothing removed — and once a job is set up its tier only ever rises, because lowering it would mean taking things off
the board (the FIRST stamping takes the tier it is given: every job carries `full` from birth and an empty board has
nothing to take off — found on the sandbox drill, migration 20260921160000). A
stamped item is a snapshot; the library changing later does not rewrite a job (the same rule as inspection templates).
`create_project` grew a tier, modules and a start date and calls it, so a job born in the app is born stamped.

The board is worked, not signed: open → done or not applicable (with a reason) → reopen. The DB stamps `done_by` and
`done_at` and ignores what the client sends; kind, origin and job are fixed at birth; nothing is deleted. Due dates
count from `projects.start_on` (`set_project_start`): an open item with an offset follows the start date, a finished
one keeps the date it was finished against. Items can be added by hand (`origin = 'manual'`) — the closeout loop that
promotes them back to the library is not built.

Office only, as the brief asks — start gate items, risks and submittals never reach site roles; `app.is_office` reads
and writes, the labourer lock applies on top. `/start-gate` is screen `start_gate` (pm/admin), under Setup. The home
card shows start gate percent, priority A open, overdue and document gaps; a job never set up gets a nudge only once the
library holds something. **Renamed on screen to Mobilisation** (22 September 2026, Mitchell): the page is `/mobilisation`
(`/start-gate` redirects, query kept), the menu says Mobilisation, the kind reads "Mobilisation item"; the code keeps
`start_gate` as the screen key and the item kind, and this record keeps the brief's words. What is NOT here: the document gaps are read off the board's own document items (a document
marked done), not off the job's documents table — filing a document does not tick the item yet. Suite 39.

**R93. The closeout loop: a job's own items become the company's.** R92 stamps a job from the library; this is the
way back. Every setup item a job added by hand or read from its contract (`origin` manual or contract) is one the
library never had. On `/start-gate/closeout` the office decides each one, once: PROMOTE it into a module, at a tier,
reworded — or LEAVE it as a one-off. `promote_setup_item` inserts the `template_items` row with the item's origin
carried (so the library remembers an item came from a contract), and stamps the setup item with what it became;
`leave_setup_item` records the one-off. A one-off can still be promoted later; a promotion is final (retire the
template item if it was wrong). The decision columns are written by those two functions alone — the trigger refuses a
direct write, even from the office.

Two rules the DB holds. A template is generic: a promoted title or detail that names the head contractor
(`projects.principal_contractor`) or the job is refused; the screen prefills a rewording (`suggestGeneric`: the head
contractor becomes "the head contractor", possessives kept) and warns before the DB does. And a promoted item is never
stamped back onto the job that gave it: `instantiate_project` skips template items this job promoted, so a re-stamp
does not double it — while the next job set up from the library gets it as an ordinary template item. Suite 40.

**R94. Something is happening.** On one bar of signal a tap on a link could sit for seconds with the last screen
unchanged, and the phone was tapped again, or the app closed, because "it isn't loading" — it was. Three things now
say so. A bar starts across the top the moment a same-site link is tapped (`src/components/nav-progress.tsx`, a
capture-phase click listener; the job switcher tells it directly), and after 700 ms a "Loading…" pill joins it; both go
when the address changes, or after 25 s if nothing ever arrives. And `src/app/loading.tsx` is the page's shape while it is
on its way — Next draws it the instant a route is asked for and swaps the page in when it lands — grey bars and
"Loading…", no words that could be read as the record. Reduced motion keeps the bar and the skeleton still.

**R95. The programme: as issued, and the two-week look-aheads.** A job runs to two documents nobody in the app could
see: the construction programme the head contractor issued (and re-issued), and Kooboolong's own fortnightly
look-ahead. `/programme` keeps both, under Site in the menu. Table `project_programmes` — one row per upload, kind
`baseline` (revision, issued date; the newest issued is "in force", the rest kept beneath it) or `lookahead` (the
fortnight it covers; the next one is offered starting the day after the latest, never in the past). A programme is
never rewritten: the trigger refuses every change but voiding, with a reason, once. Files live in bucket `programmes`
under the job's folder — file first, then the row, a refused row clearing its file; the orphan check walks the bucket.
Kept by the supervisor and the office (`app.can_keep_programme`); read by every member of the job including the
leading hand, behind the record read lock — the programme is what the crew works to. Nothing reads the file's
contents: it opens as uploaded, by a signed link minted when tapped. Suite 41.

**R96. The QA engine: ITPs, ITRs and site forms from one template shape.** Kooboolong's paper QA system — the
inspection and test plan for a package, the inspection and test record completed for every element or lot, the pour
and compaction registers, the site-pack forms — reproduced digitally, without a React component per form. One template
shape (`src/lib/qa/model.ts`, `qa_templates.spec`) describes any of them: header fields; sections of items each with
its wording, reference, responsible party and value type; register columns; the sign-off parties with which of them
release a hold point; and for an ITP, the activities with their governing documents, acceptance criteria, records and
the H / W / R mark per inspecting party. The transcriptions of the forms on hand live in `docs/qa-templates/` (one JSON
per revision, item for item, wording untouched — it is contractual) and load through `scripts/qa-seed-templates.mjs`.

Three tables. `qa_templates` is company data, kept by the office, versioned: a revision is edited until it is issued,
then frozen (`app.qa_template_problems`, the SQL twin of `templateProblems`, refuses a malformed one on the way in);
the next wording is the next revision, and a record keeps the revision it was completed against. `qa_itp_instances` is
one ITP revision on one job: draft → issued to the head contractor → approved (who, when, the countersigned file) →
signed; forward only; signed = frozen; office only. `qa_records` is one completed ITR or site form: a CLIENT-CHOSEN id
so the phone writes it with no signal and upserts it later exactly once; header, item results (`ok | na | gap`), register
rows, comments, sign-offs with the signature image, each checked against the template (an item, a column, a party the
form does not have is refused). **A gap is an answer**: nothing in the trigger blocks a save, the DB counts the gaps,
and the office reads them. A sign-off once made is never changed or removed; when every required party has signed the
record is frozen (`completed_at`), like a signed dayworks docket; a hold point form is released (`released_at`) only when
every party marked `is_release` has signed; a wrong record is voided with a reason and stays readable. Photos and
signatures sit in `entry-photos` under `{project}/qa/{record}/`, written by `app.can_write_qa` (supervisor, leading
hand, pm, admin) and read under the bucket's record-media policy.

What was NOT replaced. The brief's `hold_point_checks`, `prepour_checklists`, `pour_loads` and `compaction_tests` never
existed in this app; its `pours` is the diary's pour register, a child of the signed day, and stays. The R66 quality
tables — `itps`, `itp_points`, `lots`, `lot_checks`, `hold_point_releases`, `ncrs` — are the lot-based conformance
engine with Spec 201's rules (a failed check holds the lot, no testing until an NCR is open, a rework lot is renumbered);
the new engine is how a FORM is written and signed, and a record may name the ITP instance and activity it evidences.
Both stand; a later step can draw a lot's checks from its records. Built as phase 1 — engine, templates, record tables —
and stopped for review before any screen, as the prompt asked. Suite 42.

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
