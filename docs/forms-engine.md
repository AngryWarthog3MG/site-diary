# Forms engine — design (item 4 of docs/stems-migration.md §6)

Status: confirmed by Mitchell 02/11/2026 (two ships; Inspections stay; one row in both registers; VOC offers the ticket).
4a is built (README R180) and 4b is built (README R181, 02/11/2026) — those sections are the record of what shipped. This file is the design as agreed.

## What it is for

Comply One's heart is a form designer: the office writes a checklist once, the crew fill it on the
phone, every failed answer lands on a register, and the ones that need fixing become actions. Kooboolong
uses it for the forms the IMS has no module for — fatigue, journey management plan, Take Time, field
leadership observation, workplace hazard inspection, VOC, on/off hire, weekly crack inspection, training
evaluation. The IMS gets the engine, not Stems' data.

## What already exists, and what stays

| Today | Keeps doing its job | Why not fold it in |
|---|---|---|
| Inspections (R37) — a flat ok/issue/na list, one signature, frozen | Yes, untouched | Frozen records exist on Curtin and Kalgoorlie; the four built-ins become FORM templates too, and the Inspections screen stays until nobody opens it |
| Plant prestarts per kind (`checklist.ts`) | Yes | Registration and defect rules live there (R46, R64). Light and heavy vehicle prestarts are ALREADY kind `truck` — no form needed |
| Prestart meeting, toolbox talk, SWMS, permits, QA records | Yes | Each has its own law and its own freeze |
| Obligations (R61) | Yes | A scheduled form is listed on What's due as a DERIVED item, the way a sheet's review date is — never copied into `obligations` |

The forms engine is for everything that has no module. A new paper checklist is a form template, not a
new table.

## Tables

All org-scoped reads `app.reads_org_record` / `app.reads_record`; a labourer reads only what the audience
lets them fill and only their own submissions (restrictive policy, R75 pattern).

**`form_templates`** — the company's forms, versioned.
- `org_id`, `code` (FRM-001… by the DB), `title`, `category` (safety | plant | vehicle | people | environment | quality | other), `revision` (A, B… — a revision is a NEW row with `supersedes_id`; issued = frozen; the next wording is the next row, as QA templates do)
- `status` draft → issued → superseded | retired (never deleted)
- `profile` **public** (anyone in the audience starts it any time, from the phone) | **scheduled** (opened from a schedule, assigned, with a due date; may still be started by hand)
- `audience` roles[] (empty = every member; `['labourer']` is how a fatigue checklist reaches a labourer)
- `subject` none | plant | person — a form about a machine carries `plant_id`; about a person, a staff name (VOC, observation)
- `spec` jsonb — the form itself (below). `app.form_template_problems(spec)` refuses issue of a broken one; TS twin `templateProblems`
- `pass_mark` integer % or null; `photo_on_fail` boolean; `signature` required | optional | none; `competency_key` text (a passed VOC OFFERS a ticket, below)

**`spec`**: `{ header: HeaderField[], sections: [{ title, questions: Question[] }] }`
- `Question = { key, label, type, required, help?, weight?, fail?, raise_action?, photo_required?, options?, min?, max? }`
- types: `yes_no` (with `fail: 'no' | 'yes'`), `ok_issue_na` (issue fails), `pass_fail`, `score` (0–`max`, weight → the template's score; a value under `fail` fails), `number` (unit; outside `min`/`max` fails), `select` (`options`, `fail_options`), `multi`, `text`, `date`, `time`, `photo`, `person` (from staff), `plant` (from the register), `signature` (an extra party)
- Score = Σ weight × (answer / max) over scored questions, as a %. `app.form_score(spec, answers)` in SQL, `score()` in TS; the DB's number is stored, the TS one only previews.
- `raise_action` on a question: a failing answer makes a NON-COMPLIANCE that is also an ACTION (below). `photo_required` on a question: a failing answer refuses sign-off without a photograph.

**`form_schedules`** — when a scheduled form falls due.
- `template_id`, `org_id`, `project_id` (null = company-wide), `assigned_to` (uuid), `subject_plant_id` / `subject_person`, `every` + `unit` (day | week | month), `first_due_on`, `active`
- `next_due_on` computed by the DB from the LAST COMPLETED submission (the obligations rule: a maximum interval limits the gap) — `app.form_next_due`, TS twin `nextDue`
- The nightly sweep (`forms=1`) pushes the assignee when a schedule is due within 3 days or overdue, once a night, and emails `projects.report_emails` the overdue ones

**`form_submissions`** — one filled form.
- phone-chosen `id`; `template_id`, `template_code`, `template_title`, `revision`, `spec` **copied at start** (a reworded template never changes what was asked — R37), `project_id` (null for a company-wide form), `schedule_id` nullable, `subject_plant_id` / `subject_person`
- `answers` jsonb `{ [key]: { value, note?, photo_paths? } }`, `header` jsonb
- `status` open → completed (signature or finish) → voided (reason, office only, never deleted)
- `score` numeric, `outcome` pass | fail | null (stamped by the DB at completion from `pass_mark` and the failing answers), `started_by`, `completed_by`, `completed_at` (DB clock) + `completed_on_device_at`, `signature_path` (`entry-photos/{project|org}/form/{id}/sig.png`, own folder enforced)
- born open and SAVED AS IT GOES: the phone upserts the row through outbox kind `form_save` (answers + photos as blobs), so a journey plan half-filled at the depot survives a reload; `form_complete` carries the signature. Completed = frozen. A completed submission with a schedule stamps the schedule's `last_done_on`.
- the DB refuses completion while a REQUIRED question is unanswered, a failing `photo_required` question has no photograph, or the signature is required and missing

**`form_non_compliances`** — every failing answer across every form (Stems' non-compliance register).
- written BY THE DB (after-trigger on completion), one row per failing question: `submission_id`, `question_key`, `question_label` (snapshot), `answer`, `note`, `photo_paths`, `raised_as_action` boolean
- `status` open → resolved (with `resolution`, `resolved_by/at`, DB-stamped, then frozen) | removed (with a reason — "not a real finding" — office only). Never deleted.
- when the question had `raise_action`, the same row is ALSO an action: `action` text (the question's label, prefixed by the form title), `owner_name`, `assigned_to`, `priority`, `due_on`, `done_at/by/note` — and it joins `action_register` as origin **`form`**, so `update_action` / `complete_action` grow one branch each and the R177 register, push and nightly reminder cover it without new code. Resolving the non-compliance completes the action and the other way round (one row, two views of it).

## Who does what (SQL first, TS mirror)

| Act | Rule |
|---|---|
| Design, issue, retire a template; set schedules; remove a non-compliance | `app.is_org_office(org)` — pm/admin (the office, R136) |
| Start and fill a form | a member of the job whose role is in the template's `audience` (or any member when empty) — `app.can_fill_form(template, project)`; a labourer only a form whose audience names them, and reads only their own submissions |
| Complete / sign | whoever started it, or any role that `can_run_talks` on the job |
| Resolve a non-compliance / act on the action | `app.can_run_talks` (the site), as inspection actions |
| Void a submission | office, with a reason — the row stays |

## Screens

- `/forms` — screen `forms`, under **Safety** (site scope): "Fill a form" (the public forms in the caller's audience, big buttons), then **due** (this job's schedules, overdue first), then the **completed-forms register** (template, date, by, subject, score, outcome; filter by form and month; `?scope=company` for the office). One Home at the top, folds for the long lists (R101).
- `/forms/fill/[id]` — the form itself, one screen, sections as folds, big answer buttons, photo per question, signature pad at the end. Saves as it goes (outbox). Works offline from the first tap.
- `/forms/[id]` — a completed submission, read-only, its non-compliances with Resolve, "Print" → `/api/forms/[id]/pdf` (never stored; `outputFileTracingIncludes`).
- `/forms/non-compliance` — the register of failing answers across every form on the job (company-wide for the office): open first, with Resolve / Raise as action / Remove.
- `/forms/calendar?month=` — month grid (`monthGrid` from deliveries, reused) of scheduled forms: due, done, overdue, by day; tap a day to start one.
- `/forms/design` — screen `forms_design`, **Company › Standards** (office): the template list and the designer — sections, questions, types, weights, fail rules, raise-action, photo-required, pass mark, audience, profile, subject; "Issue" freezes it; "New revision" copies it to a draft. "Import" reads a one-question-per-line text the way `templateFromLines` does, so a paper checklist is typed in in a minute.
- What's due: scheduled forms overdue or due in 30 days, DERIVED (basis: the template's `basis` text, e.g. "Fatigue management procedure cl. 4"). Safety: tiles "Forms overdue", "Non-compliances open"; the home card follows the Safety loader rule.
- Labourer home: a "Fill a form" row when a public form names them.

## The ten forms, as templates (second ship)

Shipped as JSON under `src/lib/forms/templates/` and loaded by `scripts/forms-seed-templates.mjs <ORG>` — the QA pattern — so wording is reviewed in a file, not typed into a screen. Each is Kooboolong's own wording, drafted by me from what the form is for, NOT copied from Stems; Mitchell reads each before the seed runs.

1. Fatigue management checklist (public, audience every role incl. labourer; fails raise an action to the supervisor)
2. Journey management plan (public; header: route, driver, vehicle from the register, departure, ETA, check-in; subject plant)
3. Take Time (public; the task-level stop-and-think; every role)
4. Field leadership observation (scheduled, supervisor/pm; subject person; scored)
5. Workplace hazard inspection checklist (scheduled weekly; the R37 site walk, scored; fails raise actions)
6. VOC — verification of competency (scheduled or public; subject person; pass mark; `competency_key` = the plant kind; a PASS offers "Record the ticket" — a tap writes the `crew_tickets` row naming the submission; never automatic)
7. On-hire inspection / 8. Off-hire inspection (public; subject plant; photos required on any damage)
9. Weekly excavator crack inspection (scheduled weekly per excavator; subject plant; photo required on any crack)
10. Training evaluation (public; scored; no fails)

Light and heavy vehicle prestarts: already plant prestarts (kind `truck`) — not duplicated. Hazardous
substances checklist: the chemicals register (R60) — not duplicated.

## Two ships

- **4a — the engine (R180):** tables, triggers, policies, suite 70; `src/lib/forms/model.ts` (pure, node-tested); designer; fill; submission; completed-forms register; non-compliance register joined to the action register; PDF; outbox kinds `form_save` / `form_complete` / `form_nc_update`; Safety tiles and home card; README R180.
- **4b — schedules, calendar, the templates, the VOC ticket offer (R181) — built:** `form_schedules`, `nextDue`, the sweep and push, `/forms/calendar`, What's due items, twelve templates (the VOC per machine kind: excavator, roller, loader) and the seed script, suite 71.

Each ships, is pushed and deployed by Mitchell, and is drilled on T001 before the next starts.

## Not built (on purpose)

- Excel export of the register (a PDF prints; the CSV is a thin route later if asked)
- Editable dashboards per form (the Safety screen is the dashboard; a form adds tiles there, R56)
- A form that edits another record (a form never writes a diary field, a prestart, or a ticket by itself — the VOC offer is a tap)
- Deleting anything: templates retire, submissions void, non-compliances are removed with a reason
