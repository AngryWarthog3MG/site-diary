# Stems → Kooboolong IMS: feature inventory and gap list

Written 02/11/2026 from a read-only walk of Kooboolong's Stems tenancy (Stems One 8.4.1, Comply One 7.9,
LMS One). Features only — no records, names or figures were taken. The right-hand verdict is against
Kooboolong IMS as it stands on `main` today (README R176).

Verdicts: **Have** — the IMS does this already, maybe under another name. **Partly** — the IMS has the
bones; the Stems feature adds something. **Missing** — nothing in the IMS does this.

## 1. Stems One — safety, HR, training, registers

### Dashboard and "My Stems"
| Stems feature | IMS | Notes |
|---|---|---|
| Global dashboard of widgets (expired courses & licences, actions overdue, assets overdue, company news, uncontrolled hazards, TRIFR gauge, injuries, event types, hazards reported), admin-customisable, large/small tiles | Partly | Home cards are fixed (`loadDashboard`) and draw only when something needs attention. No admin layout, no news widget |
| Company news (admin posts, shown to everyone) | Missing | Messages are one-to-one; nothing broadcasts |
| My events / my actions (what is assigned to me) | Partly | What's due and Waiting on me cover obligations, documents, actions on incidents/audits. Not one "assigned to me" list across every module |
| My scheduler (calendar of my events, actions, hazards, risks) | Partly | Deliveries calendar only |
| SMS messaging (contacts, groups, send, delivery log) | Missing | Push + email only. Needs an SMS gateway and a cost decision |
| Updates / release notes feed, Zendesk support | n/a | — |

### Safety
| Stems feature | IMS | Notes |
|---|---|---|
| Event register: configurable event records × event forms (Injury, Damage, Environmental, Near miss…), types, categories, sub-categories | Partly | Incidents have seven fixed kinds + severities. No admin-configurable taxonomy |
| Event lifecycle: Draft → investigation → investigation finished → sign-off; event manager, supervisor, reported by, line manager | Have (R178) | Open → investigating (investigation open → finished → signed off) → closed; opener, investigator, due date |
| Investigation tab: investigation dates with notification, summary, root cause analysis, contributing factors (configurable lists, can be mandatory), **5 Why** | Have (R178) | Investigation with due date, summary, sequence, findings; root causes and contributing factors from built-in + company lists (`/incidents/causes`); five whys; confidential flag; sign-off with signature. Lists are not mandatory per field |
| Confidential flag (manager, line manager, admins only) | Missing | — |
| Notifiable / High Potential flags with legal-obligation settings | Have | `notifiable`, potential severity, regulator trail (R62) |
| Hazards & risks linked to an event; risk profile link | Partly | Event ↔ SWMS/risk not linked |
| Event files, log, summary, **Export to Word** | Partly | Photos and PDF. No Word |
| GPS location on events and hazards, GPS map reports | Missing | — |
| Person-involved types, environmental amount types | Missing | — |
| Hazard register with control lifecycle: No controls → Control-pending → Controlled → Eliminated; hazard type / sub-type; hierarchy of controls; critical-risk flag; Simple / Risk / Grid / Advanced views | Have (R179) | Controls on the hierarchy, planned → in place → withdrawn; state read off them (no controls / pending / controlled / eliminated); hazard type (built-in + company list); critical-risk flag; a hazard closes only once controlled. One view, not four, by design |
| Injury management: claims register (claim number, claim status, medical status, total costs, lost days, RTW), manual claims | Missing | `classify` MTI/FAI and lost-time stats only |
| Injury detail lists: part of body, nature, mechanism, agency, treatment type | Partly | Treatment only |
| Drug & alcohol results register (type, result, unit, file, log) and random-selection generator | Missing | Health monitoring is the confidentiality tier, but D&A is not in it |

### Risk management
| Stems feature | IMS | Notes |
|---|---|---|
| Risk profile register (Project / Asset profiles; originator, assessor, owner, status, review date; Risk profile view and Risk assessment view) | Missing | SWMS steps carry a 5×5 risk; environment aspects carry significance; no company risk register |
| Task → step → hazard → unwanted event → inherent risk → controls (existing/planned) → residual → potential residual; critical controls; control type | Partly | SWMS has task/step/hazard/controls/risk-before-after. No planned-vs-existing, no critical controls |
| Risk matrix designer (admin sets the matrix) | Missing | 5×5 fixed in code |
| Business risk dashboard (average inherent / residual / potential gauges, level-of-risk counts), risk reallocation | Missing | — |

### Action register
| Stems feature | IMS | Notes |
|---|---|---|
| One action register across every origin (event, hazard, asset maintenance, audit, manual) with raised by, assigned to, due, closed, status incl. Pending-Overdue, priority, archive, Excel export, group-by | Have (R177) | `/actions`: one register over incidents, inspections, audits, reviews, compliance evaluations and manual actions; priority, assigned-to with push, overdue/due-this-week off the dates, "on you". No Excel, no archive, by design |
| Add manual action / add multiple manual actions | Missing | — |
| Configurable action types, priorities, field labels | Missing | — |

### Registers
| Stems feature | IMS | Notes |
|---|---|---|
| Asset register for everything, not just plant: plant, fire extinguishers, first-aid kits, electrical items, office equipment, vehicles; barcode, type/category/classification; simple / advanced / archived views | Partly | `plant_register` is plant only |
| Check in / check out of assets | Missing | — |
| Maintenance & inspection profiles (scheduled intervals per asset) that raise actions when due; assign to multiple items; bulk completion date | Partly | Plant inspections (reg. 213 cascade) and maintenance records exist for plant; no generic scheduled profile that raises an action |
| Distance / hours meter entry | Missing | — |
| Third-party (hired-in) asset register; on-hire / off-hire checklists | Partly | `employer` on plant row; no hire forms |
| Electrical items register (test & tag due) | Missing | — |
| Barcode printing | Missing | — |
| Consumables register (PPE, uniforms, laptops: barcode, type, category, supplier, manufacturer, allocation to people, stock, allocation report) | Missing | Template items have a consumables kind for mobilisation only |
| Hazardous materials register: substance, DG class, Hazchem code, UN number, storage location, storage inspection due, SDS file + date + expiry, site approvals | Have (mostly) | Chemicals register has GHS classes, SDS 5-year currency, where kept. Add DG class / Hazchem / UN#, a storage-inspection cycle, site approvals |
| Confined space register (spaces, last inspected, overdue) | Partly | Confined space is a permit kind; no register of the spaces themselves |

### Library
| Stems feature | IMS | Notes |
|---|---|---|
| File library: folder per job + IMS folder, upload any type to 100 MB, recycle bin, search across libraries | Partly | Job documents (for Ask) and controlled documents (versioned, acknowledged). No general folders, no recycle bin |

### Reports
| Stems feature | IMS | Notes |
|---|---|---|
| Frequency rates (TRIFR, LTIFR…) by multiple periods, by org-structure type, by org item, by custom type, by year | Partly | Safety dashboard: rate per million hours, days since last injury, month buckets. No LTIFR/TRIFR series by period or org item |
| Event records / forms / types / categories, by org item, by period; root causes & contributing factors; event details; GPS map | Partly | Incident counts by kind |
| Hazard ID by org item / period / GPS | Partly | — |
| Actions: status, types, origins; origins by org item | Partly | Open/overdue counts |
| HSE scorecard (configurable) and Safety count | Missing | — |
| Injury overview / by period / breakdown (body part etc.) | Partly | — |
| Completed training, training hours | Partly | Training gaps email; no completed-training report |
| Consumables allocation and stock | Missing | — |
| Excel export on every register; Word export of an event | Partly | CSV on a few routes (plant, timesheet, claims), PDFs everywhere. No Excel, no Word |

### Human resources
| Stems feature | IMS | Notes |
|---|---|---|
| Personnel register: level (full time / contractor / casual / labour hire), type (operator / labourer / admin / safety / trades / supplier), status categories (employed, terminated, resigned, no suitable work…), employment date, primary and secondary roles, line manager, org-structure placement; import, bulk update, bulk archive, gallery | Partly | `staff` has role, phone, employer, notes, active. No level/type/status category, employment date, line manager, import |
| Personnel profile tabs: work details, personal details, work history, travel documents, payroll details, HR, hours worked, performance review, discipline, licences, training, requirements plan, certificates, medical, injury management, safety, D&A, assets, consumables, log | Partly | People page shows jobs, tickets, inductions. Missing: personal/emergency details, driver's licence & visa types, work history, payroll fields, performance reviews, discipline, medical, assets/consumables issued, audit log |
| Associates register (third-party contacts) | Partly | Subcontractors register covers companies and their documents, not individual contacts |
| Recruitment: applicant register, position register, applicant status and origin | Missing | — |
| Role profiles with required training per role and org structure | Have | `competency_requirements` by role |
| Hours worked register (monthly per person for frequency rates; bulk entry; Indigenous ratio report) | Partly | Hours come from the diary and timesheets; no monthly hours register for rate denominators per org item |
| HR reports: Indigenous ratio, personnel list, hours worked, performance reviews | Partly | — |
| ID card profile and printing | Missing | — |
| Bulk file download | Missing | Photo library zip only |

### Training
| Stems feature | IMS | Notes |
|---|---|---|
| Course register: code, short name, type (inductions, high-risk, licence, VET, internal, awareness…), unit of competency, duration, expiry months, owner (internal / external provider) | Partly | Competencies are fixed ticket types plus the org's own, with expiry on the ticket. No course catalogue with duration/UoC/owner |
| Class register and class calendar: scheduled sessions, attendees, trainer, booked status | Missing | — |
| Training matrix by org structure, role-profile requirements, org-profile requirements, custom requirements; required-only / valid-only / booked filters; icon or date display; Excel export | Have (mostly) | `/training` matrix by job or company, requirements by role, tap to record. No booked state, no org-profile requirements |
| Role matrix | Have | Requirements screen |
| Licences held with number, separate from courses | Partly | Tickets carry a number |
| Expiring-training notification profile | Have | Nightly tickets email |
| Verification of Competency records (VOC) | Partly | A VOC is a ticket today; the assessment itself lives in Comply One (below) |

### Org profiles and admin
| Stems feature | IMS | Notes |
|---|---|---|
| Hierarchical organisation structure (company → division → site/project), items assignable for safety, archived items | Partly | Company → jobs, flat |
| Organisation profile per item: contacts (roles, titles), notifications, comments, project status | Partly | Project settings hold emails and hours |
| User security: per-user permissions by module | Have | Roles + per-person screen ticks + money + people-manager |
| Settings: every list configurable (event records/forms/types/categories, person-involved types, injury body-part/nature/mechanism/agency/treatment, hazard types/sub-types, hierarchy of controls, risk types, action types & priorities, asset types/categories/classification, maintenance types, consumable types, DG classes, Hazchem codes, personnel levels/types/status, licence types, visa types, applicant status, course types/owners, field labels) | Missing | Lists are code constants (frozen labels on purpose for records) |
| Notification profiles: rule-based email templates (training expiring, hazard app submissions…) | Partly | Nightly sweeps and order watchers are fixed rules; no designer |
| Safety scorecard settings | Missing | — |
| Measurement units, blocked file types, max file size | Missing | — |
| Dashboard edit options (global vs per-user) | Missing | — |
| Upload system file | n/a | — |

## 2. Comply One — forms, checklists, inspections

| Stems feature | IMS | Notes |
|---|---|---|
| Form designer: categories, sub-categories, score designer, field designer, template designer (header / columns / footer), subheadings & questions, versioning with "outdated templates" | Partly | Inspection templates are a list of lines (`templateFromLines`); QA templates are a `spec` JSON transcribed by script; plant checklists are per-kind code. No on-screen designer, no scoring |
| Form profiles: **Public** (anyone, any time, on the mobile app) and **Scheduled** (assigned to a person, next due date) | Partly | Inspections and prestarts are started by hand; obligations schedule things but do not open a form |
| A form linked to a Stems One course, so completing it (e.g. VOC) writes the training record | Missing | — |
| Completed forms register (origin, scheduled/entered date, form id, completed by, status), show/hide columns, Excel export | Partly | Each module lists its own records |
| **Non-compliance register**: every failed question across every form, with resolution/remove | Missing | Plant defects are the only "failed item" register; inspection findings are per inspection |
| Calendar of scheduled forms (month / week / day / list) | Missing | — |
| Actions and hazards raised from a form answer | Partly | Inspection actions exist; a hazard from a form answer does not |
| Reports and editable dashboards per form | Missing | — |
| Notifications and permissions per form | Partly | — |
| Forms in use (templates, not records): Excavator / FEL / Heavy vehicle / Light vehicle / Posi-track daily pre-starts, Rock breaker checklist, KAIS weekly excavator crack inspection, Fatigue management checklist, Journey management plan, MRL Take Time, Field leadership observation, Hazardous substances checklist, Workplace hazard inspection checklist, Pre-start information meeting, Toolbox topic meeting minutes, Verification of competency, Plant hire docket, On-hire and off-hire checklists, Daily time sheet, Training evaluation | Partly | IMS has: plant prestart per kind (excavator, loader, roller, truck… in `checklist.ts`), prestart meeting, toolbox talk, site walk / environmental / quality / plant audit inspections, SWMS, timesheets. **Missing as forms**: fatigue self-assessment, journey management plan, Take Time / take-5, field leadership observation, hazardous substances checklist (as a checklist), workplace hazard inspection (monthly), VOC assessment, on/off-hire checklists, weekly crack inspection, training evaluation, light-vehicle and heavy-vehicle (road truck) pre-starts |
| Mobile app (Comply One / Stems Hub) for forms, hazards, events | Have | PWA, offline outbox |

## 3. LMS One — online learning

| Stems feature | IMS | Notes |
|---|---|---|
| Courses with content, a quiz/assessment and optional survey; course library | Partly | Controlled documents: read, time on page, typed name, quiz with pass mark (R120). A policy course ≈ a controlled document with a quiz. No slides/video/SCORM content, no surveys |
| Assignment: by admin, by rule (role / org structure), or from Stems One required training | Partly | Document audience by role; competency requirements by role. No rule engine that assigns a course |
| Completion writes the Stems One training record | Missing | A document acknowledgement does not create a ticket |
| Tracking & reports: assignment completion, learner registration, assessment attempts & times, survey completion / responses | Partly | Compliance screen for documents |
| Users & students: guest users, bulk import, proxy as user, reset password, download user data, system logs | Partly | People + Add member; no guest learner, no proxy |

## 4. Counts

| | Stems feature lines | Have | Partly | Missing |
|---|---|---|---|---|
| Stems One | 62 | 7 | 30 | 25 |
| Comply One | 11 | 1 | 7 | 3 |
| LMS One | 5 | 0 | 4 | 1 |

## 5. What the IMS has that Stems does not

Not part of the gap list, but it is the reason the migration runs this way and not the other: the daily diary
itself (voice in, signed, byte-identical PDF, evidentiary hash), site sign-in gate with QR, dayworks and
variation costing, claims register, notices to the head contractor, ITPs/lots/hold points/NCRs and the QA
engine, permits to work, subcontractor compliance, asbestos, construction records (Ch. 6), environment
(aspects, legal register, compliance evaluations), emergency plan and drills, obligations with ISO clauses,
audits and management reviews, deliveries calendar, orders, programme, mobilisation board, timesheets across
jobs, health monitoring tier, chemicals register readable by the worker, Ask over the job documents, offline-first
capture, and a money permission enforced in the database.

## 6. Proposed build order (to confirm before starting)

Grouped so each step is one README section, one migration set, one suite, and ships on its own.

1. **Action register** — one register over every origin, manual actions, priority, assigned-to, overdue, "my actions". Most other gaps raise actions into it. **Built — README R177, 02/11/2026.**
2. **Incident investigation** — investigation stage, root causes and contributing factors (company lists), 5 Why, confidential flag, sign-off, investigation due dates. **Built — README R178, 02/11/2026.**
3. **Hazard controls** — control status lifecycle, hierarchy of controls, hazard types, critical-risk flag. **Built — README R179, 02/11/2026.**
4. **Forms engine** (Comply One's heart) — **Built — 4a README R180, 4b README R181, 02/11/2026 (twelve templates seeded as drafts by `scripts/forms-seed-templates.mjs`; the office issues each after reading it).** — — a designer for checklists (sections, question types, score, fail-raises-action, photo required), public vs scheduled profiles, calendar, completed-forms register, non-compliance register. Then the missing forms as templates: fatigue, journey management plan, Take Time, field leadership observation, workplace hazard inspection, VOC, on/off hire, light and heavy vehicle pre-starts, weekly crack inspection, training evaluation.
5. **Asset register** — every asset, not only plant: types/categories, barcode, check in/out, maintenance & inspection profiles that raise actions, meter entry, electrical test & tag, third-party assets. Plant register becomes one kind of asset without moving a row.
6. **Risk register** — risk profiles (project / asset), inherent/residual/potential, existing vs planned controls, critical controls, owner/assessor/review date, dashboard gauges; SWMS risk feeds it.
7. **Training courses and classes** — course catalogue (UoC, duration, expiry, owner), class sessions with attendees and booking, completed-training and training-hours reports, VOC form → ticket.
8. **People profile** — levels/types/status categories, employment date, line manager, personal and emergency details, licences and visa, work history, performance reviews, discipline (admin-only), assets/consumables issued, log.
9. **Injury management and D&A** — claims (status, medical status, costs, lost days, RTW), injury detail lists, D&A results register with random selection (confidentiality tier).
10. **Consumables register** with allocation and stock.
11. **Chemicals additions** — DG class, Hazchem, UN number, storage inspection cycle, site approvals. **Confined space register.**
12. **Library** — folders per job, recycle bin, search; bulk download.
13. **Reports** — TRIFR/LTIFR series by period and job, hours-worked register as the denominator, scorecard, injury breakdowns, Excel export on registers.
14. **LMS** — course content (slides/video) on top of controlled documents, surveys, assignment rules, completion → ticket.
15. **Admin** — company news, configurable lists where a record is not frozen by them, notification profile designer, dashboard editor, org-structure hierarchy, recruitment, ID cards, SMS (needs a gateway and a cost call).
