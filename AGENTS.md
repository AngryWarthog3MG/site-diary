<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Kooboolong IMS

Kooboolong Services' integrated management system, built around a daily site diary for
construction supervisors. Voice in, structured record out.

The product is called **Kooboolong IMS** everywhere a person reads it — brand row, home,
tab title, push, the From line of its emails, and the PDF Producer (README R80). The diary
itself keeps the name Daily Diary, as one section of the app. The repository, the npm
package and the Vercel project stay `site-diary`.

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
npm run db:types     # DANGER — see below; src/types/database.ts is hand-written
```

**`npm run db:types` destroys `src/types/database.ts`.** That file is hand-written — its own
header says so — and holds `MemberRole`, `Profile`, `Entry` and the rest of the domain types the
app imports. The script pipes `supabase gen types` over the top of it with `>`, which replaces
all of it with a generated `Database` type that exports none of those names, and roughly thirty
files stop compiling. Add what a migration needs to the hand-written file by hand. If you have
already run it, restore with `git checkout -- src/types/database.ts`.

**If git fails with "You have not agreed to the Xcode license agreements"**, the Xcode command
line tools have been updated underneath the session. Prefix git with
`DEVELOPER_DIR=/Library/Developer/CommandLineTools`, which needs no password, rather than asking
for `sudo xcodebuild -license`.

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
  per job. The plant form refuses missing/expired, warns on none recorded; the prestart marks the un-inducted.
  `crew/inductions.ts` (`peopleOnJob` = members + roster by name, `inductionRows`, `notInducted`) backs the
  inductions block on `/settings/members`, where an induction is recorded by hand — any day up to today, with
  notes; `app.crew_inductions_before_write` tidies the name and refuses a future date. Suite 35, README R88.
  Add member (`POST /api/projects/[id]/members`) makes the account when none exists, like the bulk add
- `src/lib/outbox/` — the forms' offline queue (prestart create/edit/sign-on/finish, toolbox sign-on/finish, plant
  check). Any new form write goes through `runOrQueue(live, queue)` with phone-chosen ids, and its replay in
  `sync.ts` (also `hc_notice`, `swms_review`, `env_monitoring`, `hc_document` — README R76; show queued items with `usePending`, and never
  `router.refresh()` after a queued save — offline it blanks the screen); the PDFs print `completed_on_device_at` alongside arrival via `src/lib/pdf/finished-at.ts`
- `src/lib/plant/` — plant prestarts: `checklist.ts` (per-kind checks, frozen labels), `pdf.tsx`, `on-job.ts`
  (the machines on a job: `project_plant` → `plant_register`, the ONE plant vocabulary — there is no per-job
  plant list any more). Tables `plant_register` (org-wide fleet), `project_plant`, `plant_prestarts` (signed =
  frozen), `plant_defects`. `app.entry_warnings`
  raises `plant_without_prestart`; the TS half is `reviewQualityWarnings(payload, { plantPrestarted })`. Inspections and
  registration (README R64): `inspections.ts` (`nextInspection` — reg. 213's cascade, a date the inspector set wins, maintenance
  alone does not reset it; `registrationStatus`, `mayNotBeUsed`). `plant_register` carries `inspection_basis`,
  `inspection_interval_months` and registration fields — registration OFF by default, because most civil plant is not
  registrable. `plant_maintenance_records` (reg. 237: names the competent person and their competence, never in the future,
  frozen; optional report in bucket `plant-records`). Trigger `plant_prestarts_registration_current` refuses a prestart for a
  machine marked registrable with no number or a lapsed one (WHS Act s. 42), and the check form disables it. Machine page
  `/plant/machine/[id]`. Suite 24
- `src/lib/signin/` — site sign-in (the gate): `register.ts` (who is on site / who left, AWST clocks by
  hand, hours to the quarter), `pdf.tsx` (the day's attendance register). Table `site_signins`: the DB
  decides `inducted` at sign-in and stamps the arrival clocks; the phone's clocks travel alongside; a
  signed-out row is frozen; one open sign-in per person per day. Gate duty = `app.can_run_talks`.
  Offline via outbox kinds `signin_in` / `signin_out`. The gate FEEDS the diary's labour list: `labour.ts`
  (`mergeGateIntoLabour`, pure) puts each crew/subbie sign-in on the draft with the gate's clocks, and the
  sign-out brings the finish and hours; the row is the gate's (`source_quote` starts `Gate:`) until a clock is
  edited by hand, and a row typed or heard is only ever filled where blank. The review screen polls it every
  minute. Nothing is stored until the supervisor saves or signs, as ever
- `src/lib/swms/` — SWMS and JSA: `model.ts` (the 18 high-risk categories of WHS r.291, the 5×5 risk matrix,
  `readSteps`, `swmsProblems` — the TS half of `app.swms_problems`, the DB wins), `pdf.tsx`. Tables `swms`
  (born a draft; `active` only when complete, then frozen; a revision has `supersedes_id` and supersedes on
  activation) and `swms_signons` (only on an active version, once per person, never changed or removed —
  by anyone, service role included; the drill archives instead). Authoring = `app.can_write_swms`
  (supervisor/admin); signing the crew on = `app.can_run_talks`; signing on AS YOURSELF = any member of the job,
  `app.can_sign_own_swms` — the attendee name must be the caller's own profile name (README R89). A SWMS may be
  FILED rather than written: `swms.file_path` in bucket `swms-docs` `{project}/{swms}.ext`, complete on its own
  terms (`swms_problems` asks nothing of it), frozen once active. An active SWMS is readable by every member
  (r. 299/300) — `swms_reads_record` says so; drafts keep the lock. `/swms/sign` is the labourer's door
  (screen `swms_sign`). Outbox kind `swms_signon`. Suite 36
- `src/lib/incidents/` — hazards, near misses, incidents: `model.ts` (kinds, severities, `incidentRef` INC-001,
  `actionOverdue`, `summarise`, `urgent`), `pdf.tsx`. Tables `incidents` (numbered per job by the DB under an
  advisory lock; the first account is frozen; closes only when every action is done; closed = frozen),
  `incident_updates` (append-only, for everyone), `incident_actions` (done stamped by the DB, then frozen).
  Reporting/updates = `app.can_run_talks`; managing/closing = `app.can_manage_incidents` (supervisor/admin).
  Outbox kind `incident_report` (photos as blobs). `/api/incidents/[id]/notify` emails `projects.report_emails`
  for urgent reports, once (`notified_at`). Reports are never deleted — a drill closes its own. The WorkSafe trail for a
  notifiable incident is `incident_regulator_events` (became_aware, notified, written_notice_required/given, site_preserved,
  site_released): events, not columns, because the report is frozen on first account and the trail unfolds over days.
  `regulator.ts` reads state off them (minutes to notify, the 48-hour written notice clock, the five-year keep-until date).
  A notification must carry its method, preservation must name the duty-holder, nothing is in the future, each is frozen.
  Managers write it; the labourer does not read it. Unnotified incidents and outstanding written notices show on `/due`.
  Suite 22. README R62
- `src/lib/inspections/` — inspections and audits: `model.ts` (kinds, the four built-in templates, `templateFromLines`,
  `readItems`, `findings`), `pdf.tsx`. Tables `inspection_templates` (org; `app.can_manage_crew`), `inspections`
  (born open; the signature completes it over ≥1 answered item from its own folder — `app.inspection_answered`;
  then frozen; items are a snapshot of the template), `inspection_actions` (same shape and rules as incident
  actions). Inspecting = `app.can_run_talks`; actions = `app.can_manage_incidents`. Outbox kind `inspection_submit`
  (photos + signature as blobs, one item). The orphan check reads paths inside `items` JSON (addRef recurses)
- `src/lib/permits/` — permits to work: `model.ts` (kinds, per-kind controls before work and at close-out,
  `permitRef` PTW-001, `live`/`expired`), `pdf.tsx`. Table `permits`: born open; issued only when every control is
  yes/N/A, both signatures sit in its own folder and the window is sane (`app.permit_controls_answered`,
  `app.permit_path_ok`); then frozen but for close-out (every check + signature) or cancel (with a reason); then
  frozen entirely. A permit past `valid_to` still counts until closed. Raising/closing = `app.can_manage_incidents`.
  Outbox kinds `permit_issue` (two signature blobs) and `permit_close`
- `src/lib/orders/` — orders and plant issues: `model.ts` (kinds material/plant_issue, per-kind status words,
  `orderRef` ORD-001, `summarise`). Tables `orders` (numbered per job by the DB; the request editable only while
  open; ordered/done/cancelled stamped by the DB; finished = frozen; a moved request is never deleted, the raiser
  removes their own open one) and `order_updates` (append-only). Raising = `app.can_run_talks`; ordering,
  receiving, fixing, cancelling = `app.can_progress_orders` (crew + PM). Photos `{project}/order/{id}/`. Screens
  `/orders` (raise form inline), `/orders/[id]`. Outbox kinds `order_raise` (photos as blobs), `order_status`.
  An urgent request emails `projects.report_emails` once via `notify.ts` (`notified_at` server-only; nightly retry).
  A plant issue is NOT a prestart defect and never becomes one — Mitchell's decision; see README R46
- `src/lib/gate/` — the visitor gate: `model.ts` (`newGateToken`, `gateUrl`, `DEFAULT_RULES`, `validateGateSignIn`).
  Table `gate_tokens` (one active per job; rotate = revoke + new). Public routes `/gate/[token]` and
  `/api/gate/[token]/{signin,signout}` (listed in `PUBLIC_PATHS`; service role; rate limit 60/10 min per job) write
  `site_signins` rows with `self_signed = true` and `signed_in_by null` — the trigger refuses that combination from
  any signed-in account. The visitor's phone keeps the row id (localStorage) as its only key to sign out.
  `/signin/gate` shows the QR (`qrcode` → SVG) and prints the A4 sign (`/api/gate/sign`)
- `src/lib/subcontractors/` — subcontractor compliance: `model.ts` (`REQUIRED_DOCS` = public liability, workers'
  comp, SWMS; `compliance()` → compliant/expiring/lapsed/missing/none_recorded from dates alone; `normaliseCompany`).
  Tables `subcontractors` (org; unique per normalised name), `subcontractor_documents` (retired, never rewritten or
  deleted), `project_subcontractors` (engagement per job). Bucket `subcontractor-docs` `{org}/{sub}/{doc}.ext`, row
  first then file. Managing = `app.can_manage_crew` (org) / `app.can_manage_incidents` (engagement). The gate register
  flags a lapsed company on sign-in; nightly `tickets=1` also emails the subcontractor digest
- `src/lib/documents-control/` — policies and procedures: `model.ts` (`coverage` of the crew against a version's
  acknowledgements). Tables `controlled_documents` (org; unique title), `document_versions` (numbered under a lock;
  issuing supersedes the current; frozen; never deleted; file in `controlled-docs` `{org}/{doc}/{version}.pdf`, file
  first then row), `document_acknowledgements` (current version only, once per person, frozen; signature in
  `entry-photos` `{project}/document/{ack}/sig.png`). Issuing = `app.can_manage_crew`; acknowledging = `app.can_run_talks`.
  Outbox kind `doc_ack`. Screens under `/procedures` (not `/documents`, which is the job's reference documents for Ask)
- `src/lib/training/` — the training matrix: `model.ts` (`competencies` = fixed ticket types + the org's own,
  `cellFor`, `buildMatrix`, `mergePeople`; relative imports — Node-tested). Tables `org_competencies` (org's own,
  keyed) and `competency_requirements` (role → competency; role normalised). Records stay in `crew_tickets`. Screens
  `/training` (job or whole company; tap a cell to record), `/training/requirements`; PDF GET `/api/training/pdf?project`;
  nightly `tickets=1` also emails `trainingGaps()`
- `src/lib/chemicals/` — the hazardous chemicals register: `model.ts` (GHS hazard classes, `currentSds`,
  `sdsStatus` — a sheet is current for five years from the date printed on it, `registerFor`), `load.ts`.
  Tables `chemical_products` (org-wide, one product once), `chemical_sds` (retired never rewritten or deleted,
  newest active sheet is the one the register holds) and `project_chemicals` (what is on THIS workplace, with
  where it is kept). Bucket `chemical-sds` `{org}/{product}/{sds}.ext`, file first then row. Keeping the
  product list and its sheets = `app.can_manage_crew`; saying what is on site = `app.can_run_talks`.
  **This is the one record table with NO `_reads_record` restrictive policy, on purpose**: reg. 346(3)
  requires the register be readily accessible to the workers involved, so the labourer reads it and `canSee`
  lists `chemicals` among their doors. The screen prints — that is the backup WorkSafe WA asks for when the
  power or the network is out. Suite 20. README R60
- `src/lib/obligations/` — what falls due, and whether it happened on time: `model.ts` (`nextDue` counts from when the
  last occurrence was DONE, because a maximum interval limits the gap between two; `dueStatus`, `onTime`, `PRESETS`
  each carrying its clause), `load.ts` (merges SCHEDULED rows with DERIVED ones read off their own records — a
  sheet's review date, a ticket's expiry — never copied). Tables `obligations` (per job, or company-wide with a null
  project) and `obligation_completions` (due_on from the schedule, done_on from the person, never in the future,
  `done_by` stamped by the DB, then frozen). Setting/discharging = `app.can_manage_incidents` per job,
  `app.can_manage_crew` company-wide; reads refuse the labourer. Screens `/due`, `/due/[id]`; home card when
  anything is overdue or due in 30 days. A NEW thing that falls due on a cycle is a row here or a derived item in
  `load.ts`, not a new screen. Suite 21. README R61
- `src/lib/emergency/` — the emergency plan per workplace and its drills: `model.ts` (`currentPlan` = highest version,
  `nextDrillDue` counts from the last drill on the workplace, or the plan's issue day if none, by the frequency the plan
  itself states — reissuing the plan does not reset it), `load.ts`. Tables `emergency_plans` (versioned per project, the
  version numbered by the DB under a lock, frozen once issued — a change is a new version) and `emergency_drills` (against
  a plan of the same workplace, never in the future, frozen). Issuing = `app.can_manage_incidents`; drills =
  `app.can_run_talks`. **The plan is readable by every member including the labourer** (reg. 43(1)(c); the muster point is
  theirs), and the labourer home shows it with a 000 button; the drills follow the record read lock. `/emergency`; What's
  due shows a missing plan as overdue and the next drill from the plan's frequency — there is no manual drill preset. Suite
  23. README R63
- `src/lib/construction/` — Chapter 6 records (README R65): `model.ts` (`trenchProblem` mirrors the DB constraints — reg. 306
  control at 1.5 m, engineer advice needs its written reference; `servicesInfoCurrency`; `withoutWhiteCard`, reg. 317).
  `projects.is_principal_contractor` (off by default, admin sets it). `whs_management_plans` (regs 309–313: only when principal
  contractor — the DB refuses otherwise; reg. 310's five headings required; versioned by the DB, frozen) and
  `excavation_records` (reg. 304: services information source, reference, obtained date, optional plans in bucket
  `services-plans` `{project}/{record}.ext`; reg. 306 trench control; frozen). Both readable by every member — regs 311 and
  304(4) — though the screen is not a labourer door. Nothing in the app is purged, which is how regs 303 and 313 retention is
  met; do not add a purge. `/construction`; What's due flags a principal contractor with no plan and crew with no white card.
  Suite 25
- `src/lib/quality/` — ITPs, lots, hold points, NCRs, calibration (README R66). `model.ts` mirrors the DB rules
  (`lotCloseProblems`, `testingAllowed`, `holdsAwaitingRelease`, `ncrReportState`, `calibrationStatus`, `calibratedOn`,
  `pointProblems`); the DB wins (`app.lot_close_problems`, the triggers in 20260916190000 and 20260916190100). Tables:
  `itps` + `itp_points` (draft editable; issued frozen; a revision with `supersedes_id` supersedes on issue; points only change
  on a draft), `lots` (numbered per job, worked to an ISSUED ITP; `open → nonconforming → open` only as its last NCR closes;
  `conforming` only with every point resulted and none failing, every hold point released, no NCR unclosed; a rework lot
  with `replaces_lot_id` marks the original `replaced`), `lot_checks` (frozen; a calibrated point needs equipment in
  calibration ON the check date; a failed check puts the lot on hold; no testing on a held lot until an NCR exists and none is
  open — Spec 201 cl. 201.06.04; `created_at` is `clock_timestamp()` so "latest" works inside one transaction),
  `hold_point_releases` (a hold point, open lot, latest check conforms; frozen), `ncrs` (numbered; observation frozen; approve
  needs root cause, corrective action, disposition and an approver's name, then those freeze; close lifts the lot's hold),
  `measuring_equipment` + `equipment_calibrations` (org). `projects.ncr_report_hours` is the CONTRACT's reporting clock, null
  = none — never hard-code 24. Writes: ITPs and NCR approval = `app.can_manage_incidents`; lots, checks, releases, raising an
  NCR = `app.can_run_talks`; equipment = `app.can_manage_crew`. Labourer reads none. `/quality` and `/quality/{itp,lot,ncr}/[id]`,
  `/quality/equipment`. Suite 26
- Audits and management reviews (README R67): tables `audits` + `audit_findings`, `management_reviews` + `review_actions`
  (migration 20260916200000). Drafted, then issued, then frozen; an audit issues only with `auditor_independent` and a
  summary (ISO 9.2.2 c). A finding's or action's done is stamped by the DB once, then frozen; an issued review's actions do
  not change and are carried forward until done. Issuing one that names its schedule (`obligation_id`, kind must match) inserts
  the `obligation_completions` row IN THE SAME TRIGGER, using `app.obligation_next_due` — the SQL twin of `nextDue`; change
  both together. Access reuses `app.obligation_readable` / `app.obligation_manageable`. `/audits`, `/audits/{audit,review}/[id]`;
  open actions appear on What's due. Suite 27
- `src/lib/asbestos/` — regs 425, 429, 466 (README R68): `model.ts` (`registerInForce`, `planReviewDue` five-yearly, `notBriefed`,
  `notRequiredProblem` — all three limbs, `removalProblems` — five days' notice unless emergency, friable is Class A). Tables
  `asbestos_registers` (status received | own | not_required; names the duty holder; `superseded_by` is the only change a register
  takes, once; files in bucket `asbestos-docs` `{project}/{register}/{register|plan}.ext`), `asbestos_acknowledgements` (who was
  briefed, once per person, on the register in force only), `asbestos_removals` (constraints mirror reg. 466). Registers and
  briefings readable by every member (reg. 425: accessible to workers); removals follow the record read lock. `/asbestos`;
  What's due flags a missing plan where asbestos is present, the plan's review, and crew not briefed. Suite 28
- `src/lib/health/` — health monitoring (README R69), the CONFIDENTIALITY TIER: `model.ts` (`latestPerPerson`, `programmesDue` —
  counts per programme, never names, `retainUntil` 30/40 years, `leadNotifyBy` 7 days). Tables `health_record_keepers` (named per
  org; admin appoints/revokes, stamped; never deleted), `health_monitoring_programs` (hazard + basis; `app.can_manage_crew` or a
  keeper), `health_monitoring_records` (KEEPERS ONLY via `app.is_health_keeper` — not admin, not any screen tick; frozen;
  `retain_until` stamped), `lead_risk_notifications` (within 7 days, constraint). Bucket `health-records`
  `{org}/{program}/{record}.ext`, keepers only. `/health`. Never put a monitored person's name anywhere a non-keeper reads —
  What's due, the safety dashboard, a PDF, a push, an email. Suite 29
- `src/lib/people/name.ts` — the name on the sheets (README R70): `cleanName`, `needsName`. `requireUser` redirects a nameless
  account to `/name` (which must never call `requireUser`); admins set names via PATCH `/api/projects/[id]/members` `{ userId, name }`.
  DB constraint `profiles_full_name_is_a_name`. Never print an email where a person's name belongs. Suite 30
- `src/lib/environment/` — environmental management (README R73): `model.ts` (`significance`, `evaluationProblems` / `inScope` —
  TS half of `app.compliance_scope_missing`, `envIncidentState` — Spec 204 clocks from `projects.env_report_hours_*` / `env_investigation_days`
  (null = none, never hard-code) and EP Act s. 72, `rainPrompts` — `projects.env_rain_inspection_mm` against `project_weather_days`, a
  prompt only, `monitoringOutcome`). Tables `env_significance_criteria` (versioned by the DB, frozen), `env_aspects` (org; significance
  stamped by the DB; history in `env_register_history`; never deleted), `project_env_aspects`, `env_legal_obligations` (org or job) +
  `env_obligation_aspects`, `compliance_evaluations` + `compliance_evaluation_results` (audits pattern: issue needs every obligation in
  scope answered, discharges the schedule), `incident_environment_events` (environmental incidents only, frozen), `env_monitoring_records`
  (DB judges value against limit; exceedance needs action; frozen). `/environment`, `/environment/evaluation/[id]`, panel on
  `/incidents/[id]`; What's due source `environment`. Labourer reads none. Suite 31
- `src/lib/subcontract/` — WORKING UNDER A HEAD CONTRACTOR (README R74; Kooboolong's usual position): `model.ts` (`headContractorName`,
  `noticeState`, `currentDocs`, `swmsReviewStatus`). `projects.principal_contractor` = the head contractor's name; `is_principal_contractor`
  true switches all of this off. Tables `incident_notices` (told up; `app.can_run_talks`; frozen), `head_contractor_documents` (their plans
  as received; supersede once; bucket `head-contractor-docs` `{project}/{doc}.ext`), `swms_reviews` (submitted → accepted | returned with
  comments; `app.can_write_swms`; frozen). Panels on `/incidents/[id]` and `/swms/[id]`; section on `/construction`; What's due items.
  Never assume a Main Roads / Superintendent contract: offer Spec 201/204 as where the head contract requires it. Suite 32
- `src/lib/safety/` — the dashboard: `stats.ts` (pure: `classify` injuries MTI/FAI, `injurySummary` with the
  rate per million labour hours, `daysSinceLastInjury`, `monthBuckets`, `overdue`), `load.ts` (one gather under the
  caller's RLS across sign-ins, prestarts, plant, permits, incidents, inspections, tickets, subcontractors, SWMS,
  documents, labour hours). Screen `/safety`; GET `/api/safety/pdf?project`. No tables of its own — every number
  is read from the modules, never typed
- `src/lib/nav.ts` — the ONE list of the app's sections (`NAV_GROUPS` under seven headings, `showNav`, `navFor`).
  The home page draws it as the heading bar (`src/components/section-bar.tsx`), the phone's Menu drawer as a
  list, the desktop rail as links. A section is added, renamed or moved there and nowhere else; each drawing
  filters it by role through `canSee`. `scope: 'company'` on a section puts it under the Company heading that
  `navFor` draws after the job's (README R87) — a screen whose record is the organisation's, not the job's. A
  screen that is both (Plant, Chemicals) stays with the job and names the company on its company half. The
  file imports `./roles.ts` with the extension because `src/lib/jobs.ts` is node-tested and loads it directly
- `src/lib/jobs.ts` — which job you are looking at, and how it sticks (README R87): cookie `kbl-job`;
  `preferJob` puts the chosen job first in the memberships `requireUser` and `/api/me` return, so every screen
  that falls back to "the first active job" opens on it; `switchTarget` is where a switch lands (the section,
  never another job's detail page); `onJob` writes a screen's address. The middleware writes the cookie from
  `?project=`. The cookie is a preference, never a credential — only a job the account holds, and awake, moves.
  `src/components/job-switcher.tsx` draws it in the rail and the drawer
- `src/lib/home/dashboard.ts` — the home page's cards (`src/app/dashboard-cards.tsx`, streamed in under Suspense):
  `loadDashboard` = `loadSafety` plus the open reports and the latest issued documents. No number on the home
  is computed anywhere the Safety screen does not also compute it. A card is drawn only when it has something
  in it; the rest fold into one "Nothing needs attention" line naming what was checked (README R56). A new card
  declares its own `attention` test
- `src/lib/undo/history.ts` — undo/redo for the day's review screen only (README R79): pure `begin`/`record`/`undo`/`redo`,
  50 steps, snapshots of the whole review payload. Never offer undo over a signed entry or a frozen row — that is a correction
- `src/lib/review/move.ts` — moving a daywork row onto its variation (README R82): pure, so it is an ordinary payload
  change that autosaves and that Undo reverses. It will not move without a register number, and what a variation has no
  field for (labour, plant, materials, docket) is kept in the description verbatim — never parsed into `crew`. There is
  no move the other way, on purpose
- `src/lib/templates/` — the company's template library (README R91): `template_modules` (six shells per company; core is
  every job) and `template_items` (kind, module, tier, priority, owner, par level, folder; `origin` for the closeout
  loop; retired never deleted). Read by every member of the company, written by `app.is_org_office` (pm/admin anywhere
  in it). `/templates` is screen `templates`, pm/admin, company scope. Suite 38
- `src/lib/setup/` — the job's SETUP BOARD (README R92): `project_modules` (attached, never detached; core always) and
  `project_setup_items` (a snapshot of the template items at stamping; open → done | not_applicable, the DB stamps
  done_by/done_at; kind/origin/job fixed; never deleted). `public.instantiate_project(project, modules[], tier)` is
  additive and idempotent; the first stamping sets the tier, after that it only rises; `create_project` calls it, so a new job is born stamped; `set_project_start`
  fills due dates from `projects.start_on` + `due_offset_days` for OPEN items. `model.ts` (`summarise`, `orderSetup`,
  `dueOn`, `isOverdue`), `load.ts` (the home card). `/mobilisation` (was `/start-gate`; it redirects) is screen `start_gate`, called Mobilisation on screen, pm/admin only — the brief keeps
  start gate items, risks and submittals from site roles. Not built: filing a document ticking its item. Suite 39.
  The CLOSEOUT LOOP (README R93): `closeout.ts` (`undecided`, `suggestGeneric`, `jobSpecifics`); `/mobilisation/closeout`;
  `promote_setup_item` (inserts the template_items row, origin carried, refuses the head contractor's or the job's name,
  stamps `promotion_decision`/`promoted_template_item_id`) and `leave_setup_item`; the trigger refuses a direct write of
  those columns (`app.closeout` setting); `instantiate_project` skips what the job itself promoted. Suite 40
- `src/lib/notices/` — notices to the head contractor and the site events they stand on (README R90). Table
  `site_events` is the diary's SEVENTH SECTION (`entry_section` value `site_events`; nil question; conditional key in
  the hash; child of the day like dayworks — rewritten on save, frozen at signing). Tables `notices` (office-only via
  `app.is_office` = pm/admin; numbered per job; drafted only from an event on a SIGNED day; frozen once sent but for
  voiding; NEVER sent by the app) and `site_event_triage` (a decision that no notice is needed, with its reason).
  `model.ts`: `hoursSince` from the time said or knock-off, `draftFromEvent` (the words verbatim, nothing invented).
  `/notices` is screen `notices`, pm/admin only. The prompt must never tidy `said_text`. Suite 37
- `src/components/nav-progress.tsx` + `src/app/loading.tsx` — the loading signal (README R94): a top bar on any same-site
  link tap (capture-phase listener; `navPending.start()` for a navigation from code), a "Loading…" pill after 700 ms, both
  cleared when the address changes; the root `loading.tsx` skeleton draws while a page is on its way. A new segment that
  wants its own shape adds its own `loading.tsx`; nothing in a skeleton may read as a number or a record
- `src/lib/calendar.ts` — `isRestDay`: weekends with nothing recorded are rest days, not holes. One definition for
  the screens, the weekly and the reminder
- `src/lib/dayworks/` — the dayworks schedule (README R72): `schedule.ts` (pure: `readRange`, `buildSchedule` by Monday weeks,
  `scheduleLines` — the order the sign-off sheet numbers items in; hours null is "not recorded", never 0), `load.ts`
  (diary.dayworks + `loadDocketsAdded`, unsigned days counted apart, `pendingCorrectionDays`), `photos.ts` (each item's
  photographs as data URIs under the caller's RLS, capped), `pdf.ts` (the schedule, and `dayworksSignoffHtml` — the sheet the
  head contractor signs, README R83). `/dayworks` and `/api/dayworks/pdf` (`?signoff=1` for the sheet) are the `claims`
  screen. `signoff.ts` + table `dayworks_signoffs`: the head contractor's signature on a sheet, with the countersigned
  file and what the sheet said AT THE TIME — frozen, so a later correction cannot change what they signed; `driftFrom`
  says when the schedule has moved since. `app.can_manage_registers` writes it; the labourer reads none of it. Suite 34,
  README R86
- `src/lib/claims/` — the claims register loader and the variation register (`register.ts`:
  statuses, summary arithmetic; `warnings.ts`: what the register is quietly getting wrong about money — a variation
  valued at 0 with work behind it, days recorded against it with no hours, README R85. `load.ts` counts a corrected day
  ONCE, superseded only by a signed correction — counting every version double-counted the hours a claim is built on). Status changes only via the `set_variation_status` RPC. A day's variation
  is identified by its register number alone (`variations.register_seq`, picked from a dropdown of
  1–50); the trigger registers by number, never by words or a client reference. Rows on days signed
  before the column existed carry theirs through the link (`public.variation_number`) — read that,
  never assume the column
- `src/lib/weekly/`, `src/lib/monthly/` — reports. The month bundle is bound in parts of at most 24 MB, ONE PART PER REQUEST
  (a whole month does not fit Vercel's 300 s; README R71): `monthly/generate.ts` `planMonthlyBundle` / `buildBundlePart` is the one builder
  for the button (`POST /api/reports/monthly` plan, then `&part=N`) and the monthly email (builds nightly through the first week).
  A new PDF route must be added to `outputFileTracingIncludes` in `next.config.ts` or Chromium is missing on Vercel (501) `weekly/photos.ts` gathers the week's photographs (embedded,
  one print per photo per day, capped); `img[data-shrink]` in `src/lib/pdf/render.ts` re-encodes marked images
  before printing — never mark an image in the daily docket, its bytes must not change. A report carrying more than a
  handful of photographs must put them in `data-src`, NOT `src` (README R84): `setContent` waits for every `src` to load,
  and two dozen decoded phone photographs kill Chromium on Vercel — `data-src` is decoded one at a time
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
- **A stored PDF is never written over.** `/api/entries/[id]/pdf` establishes absence (a signed-URL failure is not proof) and
  uploads with `upsert:false`; there is no `force`. README R78.
- **A save kept on the phone never refreshes the page** — decide on the save's outcome, not `navigator.onLine` (README R78).
- **A timestamp's date is Perth's.** Never `.slice(0, 10)` a timestamptz for display — that is the UTC day, a day early for
  anything before 8 am in Perth. Use `fmtPerthDate` / `perthDate` (`src/lib/pdf/dates.ts`, arithmetic, PDF-safe). README R77.
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
- **Roles live in one table.** `src/lib/roles.ts` (`canAuthorEntries`, `canRunTalks`, `canSignIn`, `canReport`,
  `canSee`, `canManageRegisters`, `canExportReports`) is what the menu, the page guards and the APIs read.
  **Which screens open is asked through `sees(member, screen)`, never `canSee(role, …)` directly**: a project
  admin ticks screens per person (`project_members.screens`, null = the role's list, README R57), and only
  `sees` honours the ticks. Load `screens` alongside `role` wherever a membership is read for a gate;
  `app.can_run_talks()`, `app.can_sign_in()`, `app.can_report()` and `app.can_manage_registers()` mirror it in
  SQL. A new role goes in both, plus the `member_role` enum, `MemberRole` in `src/types/database.ts` and the
  members API's `ROLES` set. The labourer has two doors — the gate and hazard reporting — and `canSee` lists
  exactly those (plus chemicals and the emergency plan, which the law puts in the workers' reach). A labourer reads ONLY THE
  REPORTS THEY MADE — `app.incident_readable`, restrictive policies, and the incident photo folder (README R75). Reads: RESTRICTIVE select policies (`*_reads_record`, migration 20260915140000) keep the
  labourer out of every record table; a NEW table that belongs to the record gets one too
  (`app.reads_record(project_id)` / `app.reads_org_record(org_id)`), or a labourer can read it by API. The
  buckets follow the tables (`"record media reads by role"` on storage.objects, migration 20260916120000): a new
  bucket or folder that holds the record's media joins that policy, or a labourer can download it by Storage.
  Pages refuse a screen with a redirect; hiding the tile is not enough — every RPC and export API
  checks the role itself, because a session can call them without the page. The role gate has two
  halves and a new page needs both: the request middleware (`SCREEN_OF_PATH` in
  `src/lib/supabase/middleware.ts`) maps every screen-owned path prefix to its screen and refuses by
  the job the address names; every list and detail page calls `guardScreen(membership, screen)`
  (`src/lib/auth.ts`) for the job it actually resolved, which is what catches a mixed-role account; and an
  API route addressed by a record id (a PDF, an export) calls `forbidUnlessSees` (`src/lib/api.ts`) after
  its RLS row load, for the same reason.
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
- **Never let a Playwright error reach the output.** A failed `request.get` / `request.post` dumps the request headers,
  and those carry the signed-in session cookie — a live access and refresh token, in the transcript, twice now. Wrap every
  request in a try/catch that prints the status and at most the first line of the message. The same goes for any drill
  helper that logs an error object whole.
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
