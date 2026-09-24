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

Not yet on disk, so not yet transcribed (the QA build prompt names them): `6425-KBS-ITP-001_Earthworks_RevB.docx`,
`6425-KBS-ITP-002_Concrete_on_Ground_RevB.docx`, `6425-KBS-ITR_Set_RevB.docx`, `KBS_Kalgoorlie_Site_Pack_Forms.docx`,
`01SITE_2.PDF`, `logo.png`. Drop them into `docs/qa-source/` and the same transcription applies.
