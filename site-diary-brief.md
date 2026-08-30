# Site Diary — Build Brief

A voice-first daily site diary for construction site supervisors. The supervisor talks for
90 seconds at knock-off; the app turns that into a structured, signed, legally defensible
daily record. Project managers query the accumulated records in plain English and export
daily and weekly PDFs.

Build this as a **mobile-first web app (PWA)**. The crew is on mixed personal iPhones and
Androids — no app store, no MDM, no install friction. They open a URL and add it to their
home screen.

---

## 1. Non-negotiables

These are the constraints that make this a record rather than a note-taking app. Do not
optimise them away.

1. **Nothing is stored without the supervisor confirming it.** The AI extracts; the
   supervisor approves. The review screen is not a formality — it is the point.
2. **Signed entries are immutable.** No edits, ever. Corrections are made by a subsequent
   entry that references the original. Enforce this at the database level, not just the UI.
3. **The daily PDF contains no AI-generated text.** It renders deterministically from the
   stored structured fields. Regenerating the same entry a year later must produce a
   byte-identical document.
4. **Never invent a number.** If a quantity wasn't stated, the field stays null and the app
   asks for it. A query that finds no rows answers "no records found" — never a guess.
5. **Raw audio and raw transcript are retained on every entry.** That is the provenance
   trail when a number is disputed.
6. **Offline-first capture.** Sites have bad signal. Recording, queuing and local draft
   storage must work with no connection, syncing when it returns.

---

## 2. Stack

- **Next.js (App Router) + TypeScript**, deployed on Vercel
- **Supabase** — Postgres, Auth (magic link, no passwords for site crew), Storage (audio +
  photos), Row Level Security scoped by project membership
- **Transcription: Deepgram (nova-3) or OpenAI Whisper**, server-side. Claude has no
  speech-to-text — audio must be transcribed before it reaches the model. Prefer Deepgram
  for keyword boosting (see §4).
- **Extraction / query / narrative: Anthropic API**, `claude-sonnet-4-6`
- **Audio capture: MediaRecorder API** in the browser. Do not rely on the Web Speech API —
  iOS Safari support is unreliable and it gives no control over the vocabulary.
- **PDF: server-side Chromium (Playwright) rendering an HTML template.** Not a JS PDF
  builder — the HTML template must be the same one used on screen.
- **Offline queue: IndexedDB** (idb-keyval is enough) holding audio blobs and draft entries.

No agent framework. No LangChain. Three fixed, non-branching API calls — extraction, query,
weekly narrative — each a plain `fetch` from a server route.

---

## 3. Data model

```
organisations       id, name
projects            id, org_id, name, code, site_lat, site_lng, bom_station_id,
                    principal_contractor, active
project_members     project_id, user_id, role (supervisor | pm | admin)

entries             id, project_id, entry_no (serial per project, e.g. KBS_C001_DD_142),
                    entry_date, author_id,
                    status (draft | signed),
                    signed_at, signed_by, content_hash,
                    audio_url, transcript_raw,
                    supersedes_entry_id (nullable — for correction entries),
                    created_at
                    UNIQUE (project_id, entry_date, author_id)

labour              id, entry_id, person_name, role, area, hours, overtime_hours
plant               id, entry_id, item, hire_type (wet|dry), hours, idle_hours, supplier
work_items          id, entry_id, area, description, percent_complete (nullable)
variations          id, entry_id, description, directed_by, directed_at,
                    vr_ref (nullable), estimated_cost (nullable), photo_urls[]
delays              id, entry_id, start_time, end_time, duration_mins, cause,
                    personnel_affected, category (weather|access|design|other)
pours               id, entry_id, location, volume_m3, mix_spec, supplier,
                    docket_nos[], start_time, finish_time, docket_photo_urls[]
quantities          id, entry_id, item_type, area, quantity, unit
                    -- generic totals: pipe m, topsoil m2, plants no., formwork m2
weather             entry_id, temp_max, temp_min, rainfall_mm, wind_dir, wind_kmh,
                    source (bom_auto | manual), observed_impact
photos              id, entry_id, url, caption, taken_at, lat, lng
```

**Immutability:** a Postgres trigger rejects UPDATE and DELETE on `entries` and all child
tables where the parent entry `status = 'signed'`. On signing, compute a SHA-256 hash of the
canonical JSON of the entry and store it in `content_hash`.

`quantities` is the extensible table — anything a PM will want to total later goes there
rather than requiring a schema change. `pours` gets its own table because concrete has
enough specific fields (mix, docket, supplier) to warrant it.

---

## 4. Capture and extraction

**Flow:** record → upload audio → transcribe → extract → **supervisor reviews and confirms**
→ store → sign.

**Transcription config.** Boost the vocabulary with a per-project keyword list, generated
from: crew names on the project, plant names, area names from the drawing register, and a
fixed construction glossary (cubes, MPa, slump, blinding, subgrade, bobcat, EWP, standdown,
RFI, ITP, hold point, formwork, screed, kerb, subsoil, dripline, sleeve). Without this,
transcription mangles exactly the words that matter.

**Extraction call.** One request. System prompt instructs: return JSON only, matching the
supplied schema, no preamble, no markdown fences. Rules given to the model:

- Every field not explicitly stated is `null`. Never estimate, infer, or complete a pattern.
- Quantities keep the unit as spoken; normalise "cubes" → m³, "mil" → mm.
- Times spoken casually ("half nine", "quarter past eleven") resolve to 24h clock.
- Each extracted object carries `source_quote` — the span of transcript it came from — so the
  review screen can show the supervisor what the number came from.
- Each object carries `confidence` (high | low). Low-confidence items are pre-flagged on the
  review screen rather than silently accepted.

**Completeness check.** After extraction, compare against the six required sections (labour,
plant, works completed, variations, delays, weather). Anything empty triggers one spoken or
on-screen follow-up question — "Nothing on plant today, is that right?" — rather than being
left silently blank. A deliberate nil ("no plant on site") is a valid, recorded answer and
must be distinguishable from a gap.

**Blocking gaps.** These prevent signing:
- A variation with no `vr_ref`
- A variation with no photo
- A pour with no `volume_m3`
- A delay with no start/end time

**Weather** is fetched from BOM by project coordinates — never spoken, never extracted. If a
weather delay is claimed on a day with no recorded rainfall, flag it on the review screen for
the supervisor to confirm.

**Concrete dockets.** Let the supervisor photograph delivery dockets. OCR the m³, mix and
docket number, and reconcile against what was spoken. Where they differ, the docket wins and
the difference is shown. Supervisors estimate; dockets don't.

---

## 5. Query layer

Two paths, chosen by a lightweight classifier call:

**Structured** ("when did we pour concrete and what volumes", "total labour hours in
July", "how many rain days this month"): generate SQL against the schema, run it read-only
with the user's RLS context, then a second call to phrase the rows as an answer. Always
render the underlying table alongside the prose, with entry numbers linking back to source
entries.

**Semantic** ("what did Lendlease say about the sub-meters", "any issues with access to
Area B"): full-text search over `transcript_raw`, `work_items.description`,
`variations.description` and delay causes. Return matching entries with dates and quote the
relevant line.

Both paths cite entry numbers. Neither is permitted to answer from the model's own
knowledge — if the query returns no rows, the answer says so.

---

## 6. PDF export

**Daily.** Deterministic render of the stored entry. Header block with project, date, entry
number and weather; the six sections as ruled tables; photos appended; signature block with
signatory name, timestamp and content hash. Generated purely from stored fields.

**Weekly.** Aggregate report over a date range:
- Labour hours by person and daily totals
- Plant hours, including idle time
- Pour schedule — date, location, volume, mix, with a cumulative running total
- Quantities by item type with running totals
- Weather summary and total hours lost to standdown, by cause
- Variations raised during the period, with VR references and status
- **An AI-written narrative above the tables**, clearly headed as commentary and visually
  distinct from the record. This is effectively the first draft of a delay or variation
  claim — it should call out trends the numbers show: repeat delay causes, areas falling
  behind, variations still unreferenced.

Both exports are generated server-side, stored in Supabase Storage, and shareable by link.

---

## 7. Screens

1. **Today** — project header, entry serial, auto-fetched weather, the six required sections
   with capture status, one large record button. Shows last entry's status.
2. **Recording** — timer, live waveform, streaming transcript, and section chips that light
   up as each is recognised. This is the "template" — an ambient reminder of what's still
   uncovered, not a form.
3. **Review** — the extracted entry rendered as a site docket. Every field editable, each
   showing its `source_quote` on tap. Blocking gaps shown as amber prompts with an action.
   Sign button disabled until gaps are cleared.
4. **Signed** — confirmation, entry serial, content hash, distribution list, PDF link.
5. **Ask** (PM only) — query box, answer with table and cited entries.
6. **Exports** (PM only) — date range picker, daily and weekly PDF generation.

A reference prototype of screens 1–4 exists as a single HTML file (`site-diary-prototype.html`).
Match its visual language: IBM Plex Sans / Sans Condensed / Mono, ink `#131A1E`, paper
`#F1F2EF`, teal `#0E4F52` for primary actions, amber `#A8730A` for gaps, signal red
`#B8341F` for recording only. Modelled on a carbonless site docket book — pre-printed
condensed uppercase field labels, hairline rules, monospaced figures, serialised entries.
High contrast for sunlight, large touch targets for gloved hands. No consumer-app softness.

---

## 8. Build order

1. Schema, RLS, immutability triggers, auth, project setup
2. Audio capture + upload + transcription, with the offline queue
3. Extraction call and the JSON contract, with a test set of 20 realistic transcripts
4. Review screen with gap blocking, then signing and hashing
5. Daily PDF
6. Query layer
7. Weekly PDF with narrative
8. Docket OCR

Ship 1–5 before touching 6. A diary that reliably captures and signs is useful on its own;
a query layer over unreliable data is worse than nothing.

---

## 9. Out of scope for v1

Multi-org tenancy beyond one company, timesheet/payroll integration, scheduling links, RFI
and ITP modules, native apps, principal-contractor portal access, subcontractor entries.

---

## 10. Testing

- A fixture set of realistic supervisor transcripts — including messy ones: interruptions,
  corrections mid-sentence ("four blokes, no, five"), Australian idiom, casual times, wind
  noise — with hand-written expected extraction output. Extraction accuracy is measured
  against these on every prompt change.
- A test asserting that a signed entry cannot be updated or deleted.
- A test asserting the same entry regenerates a byte-identical daily PDF.
