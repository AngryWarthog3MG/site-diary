# QA templates — the transcriptions

One JSON file per form revision, transcribed from `docs/qa-source/` item for item, in the source order and wording. The
wording is contractual: nothing is paraphrased or shortened. `scripts/qa-seed-templates.mjs` loads them into
`qa_templates` for a company as issued revisions; an issued revision is frozen by the database, so a change to a form
is a new file with the next revision.

| Source form | Template code | Rev | Kind | Items | Register columns | ITP activities | Sign-off parties | Header fields | Hold points |
|---|---|---|---|---|---|---|---|---|---|
| 01SITE-HL-ITP-001[B].docx — Concrete Foot Paths (Type 5,6,8) | KBS_C001_ITP_001 | B | itp | — | — | 11 (4 inspecting parties, 3 specs, 6 standards) | 2 | — | 5 activities carry an H |
| 01SITE-HL-ITP-002-A_Garden_Beds.docx — Soft Landscaping | KBS_C001_ITP_002 | A | itp | — | — | 15 (4 parties, 12 specs/drawings, 7 standards, 5 checklists) | 2 | — | 9 activities carry an H |
| KBS-QA-SL-001_Soft_Landscape_Prep_and_Planting_RevA.docx | KBS-QA-SL-001 | A | itr_checklist | 44 in 8 sections | 5 (NCR / defects sub-register) | — | 4 | 21 | 3 (items 11, 26, 44) |
| 6425-KBS-ITP-002_Concrete_on_Ground_RevB.docx — Concrete on Ground (Kalgoorlie Airport Hotel, CDI 6425) | 6425-KBS-ITP-002 | B | itp | — | — | 18 (3 inspecting parties: Kooboolong, CDI, Engineer; 12 specs/drawings, 9 standards, 5 associated ITRs) | 2 | — | 13 activities carry an H |
| 6425-KBS-ITR-002_Concrete_Lot_Record_RevB.docx | 6425-KBS-ITR-002 | B | itr_checklist | 29 in 8 sections (A–H); answers Yes / No / N/A | — | — | 8 (HP1: KBS Supervisor, Electrical, Hydraulic / Fire, Other trade, Structural Engineer, CDI Site Manager (release); HP2: KBS Supervisor, CDI) | 11 | 2 (HP1 after item 18, HP2 after item 29) |
| 6425-KBS-ITR-002A_Concrete_Pour_Register_RevB.docx | 6425-KBS-ITR-002A | B | itr_register | — | 11 | — | 1 (the paper has none; the app closes a register under the supervisor) | 4 | — |

Not yet on disk, so not yet transcribed (the QA build prompt names them): `6425-KBS-ITP-001_Earthworks_RevB.docx` and
its ITRs 001 / 001A, `KBS_Kalgoorlie_Site_Pack_Forms.docx`, `01SITE_2.PDF`, `logo.png`. Drop them into `docs/qa-source/`
and the same transcription applies. The Kalgoorlie concrete set (R164) was generated from the documents' own table
cells by a script, paragraph for paragraph, so the acceptance criteria keep their line breaks.
