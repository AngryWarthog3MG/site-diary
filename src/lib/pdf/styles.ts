/**
 * Print styles for the daily docket.
 *
 * A carbonless site docket book: pre-printed condensed uppercase field labels,
 * hairline rules, monospaced figures. Shared by the PDF and the on-screen
 * view, because §2 requires one template rather than two that drift.
 */
export const DOCKET_CSS = `
:root {
  --ink: #131A1E;
  --ink-muted: #5A6469;
  --paper: #FFFFFF;
  --rule-hair: #D8DAD6;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #FFFFFF; color: #131A1E; }
body {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9.5pt;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.docket { padding: 0; }
.mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
.lbl {
  margin: 0;
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-weight: 600;
  font-size: 7.5pt;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #5A6469;
}

/* Header */
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  padding-bottom: 3mm;
  border-bottom: 1.2pt solid #131A1E;
  flex-wrap: wrap;
}
.head h1 { margin: 0.5mm 0 0; font-size: 15pt; font-weight: 600; line-height: 1.15; }
.head__right { text-align: right; }
.serial { margin: 0.5mm 0 0; font-size: 14pt; font-weight: 500; }
.sub { margin: 0.5mm 0 0; font-size: 8.5pt; color: #5A6469; }
.supersedes {
  flex-basis: 100%;
  margin: 2.5mm 0 0;
  padding: 1.5mm 2mm;
  border-left: 2pt solid #A8730A;
  color: #A8730A;
  font-size: 8.5pt;
}

/* Weather strip */
.weather { margin-top: 4mm; padding-bottom: 2.5mm; border-bottom: 0.5pt solid #C9CCC7; }
.weather__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6mm;
  margin-top: 1mm;
  font-size: 10pt;
}
.src { margin: 1mm 0 0; font-size: 7.5pt; color: #5A6469; }
.impact { margin: 1.5mm 0 0; font-size: 9pt; }

/* Sections */
.sect { margin-top: 5mm; break-inside: auto; }
.sect .lbl { padding-bottom: 1mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th {
  padding: 1.2mm 1.5mm 1.2mm 0;
  border-top: 0.8pt solid #131A1E;
  border-bottom: 0.5pt solid #131A1E;
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-align: left;
  color: #5A6469;
  white-space: nowrap;
}
td {
  padding: 1.4mm 1.5mm 1.4mm 0;
  border-bottom: 0.4pt solid #D8DAD6;
  vertical-align: top;
}
/* Right-aligned columns need room on their LEFT, not less on their right —
   zeroing the right padding ran every figure straight into the next column
   ("18.5040 MPa", "105Rain on the deck"). */
th.n, td.n { text-align: right; padding-left: 5mm; white-space: nowrap; }
th.k, td.k { white-space: nowrap; padding-right: 3mm; }
th.w, td.w { width: 40%; }
th:last-child, td:last-child { padding-right: 0; }
tfoot td {
  border-bottom: 0;
  border-top: 0.8pt solid #131A1E;
  font-weight: 600;
  padding-top: 1.4mm;
}
tfoot td:first-child {
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 7.5pt;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-align: right;
  padding-right: 2mm;
}

/* Nil and gap are printed differently on purpose — a confirmed nil is an
   answer, an unanswered section is not, and the record must not blur them. */
.nil {
  margin: 1.5mm 0 0;
  padding: 1.5mm 2mm;
  border-left: 2pt solid #131A1E;
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 8pt;
  letter-spacing: 0.06em;
}
.nil--gap { border-left-color: #A8730A; color: #A8730A; }

.notes {
  margin: 1.5mm 0 0;
  padding: 2mm 2.5mm;
  background: #F6F7F4;
  border-left: 2pt solid #131A1E;
  font-size: 9pt;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* Photos */
.photos { break-before: page; }
.photos__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-top: 2mm; }
.photos figure { margin: 0; break-inside: avoid; }
.photos img {
  display: block;
  width: 100%;
  height: 70mm;
  object-fit: cover;
  border: 0.5pt solid #C9CCC7;
}
.photos figcaption { margin-top: 1mm; font-size: 7.5pt; color: #5A6469; }

/* Signature */
.sig { margin-top: 6mm; padding-top: 3mm; border-top: 1.2pt solid #131A1E; break-inside: avoid; }
.sig__grid { display: flex; gap: 12mm; margin-top: 2mm; }
.sig__grid p:not(.lbl) { margin: 0.5mm 0 0; font-size: 10pt; }
.hash { margin: 0.5mm 0 0; font-size: 9pt; word-break: break-all; letter-spacing: 0.02em; }

/* On screen the docket sits on a sheet of paper. On anything narrower than
   the paper, the sheet fits the screen instead of cropping — the PDF is the
   fixed-format artifact; the screen view answers "what does it say". */
@media screen {
  body { background: #E7E8E4; padding: 8mm 0; }
  .docket {
    width: min(210mm, 100%);
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 14mm 16mm;
    background: #FFFFFF;
    box-shadow: 0 1px 4px rgba(19, 26, 30, 0.18);
  }
}

@media screen and (max-width: 830px) {
  body { padding: 0; }
  .docket { min-height: 0; padding: 7mm 5mm 10mm; box-shadow: none; }
  .weather__grid { gap: 3mm 6mm; font-size: 9pt; }
  th.w, td.w { width: auto; }
  table { display: block; overflow-x: auto; }
}
`;
