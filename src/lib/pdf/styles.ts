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
  --ink-soft: #EEF1ED;
  --teal: #1F5C33;
  --teal-deep: #073F3E;
  --teal-soft: #E4F1ED;
  --amber: #A8730A;
  --amber-soft: #FFF4D8;
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
.docket {
  padding: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(250, 251, 248, 0.98)),
    var(--paper);
}
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

/* The Kooboolong frog, sitting with the org name. */
.brandmark { height: 7mm; width: auto; vertical-align: -2mm; margin-right: 1.5mm; }

/* Header */
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  margin: -4mm -4mm 0;
  padding: 6mm 6mm 5mm;
  border-bottom: 0;
  border-radius: 2.5mm;
  background: linear-gradient(135deg, #073F3E 0%, #1F5C33 58%, #277B68 100%);
  color: #FFFFFF;
  flex-wrap: wrap;
}
.head .lbl { color: rgba(255, 255, 255, 0.72); }
.head h1 {
  margin: 0.75mm 0 0;
  color: #FFFFFF;
  font-size: 19pt;
  font-weight: 600;
  line-height: 1.05;
}
.head__right { text-align: right; }
.serial {
  margin: 1mm 0 0;
  padding: 1.8mm 2.5mm;
  border: 0.45pt solid rgba(255, 255, 255, 0.28);
  border-radius: 2mm;
  background: rgba(255, 255, 255, 0.12);
  color: #FFFFFF;
  font-size: 13pt;
  font-weight: 500;
}
.sub { margin: 0.5mm 0 0; font-size: 8.5pt; color: #5A6469; }
.head .sub { color: rgba(255, 255, 255, 0.78); }
.supersedes {
  flex-basis: 100%;
  margin: 2.5mm 0 0;
  padding: 1.8mm 2.3mm;
  border-left: 2pt solid #F0A41F;
  border-radius: 1.5mm;
  background: rgba(240, 164, 31, 0.16);
  color: #FFE6A9;
  font-size: 8.5pt;
}

/* Weather strip */
.weather {
  margin-top: 5mm;
  padding: 3mm 3.5mm;
  border: 0.45pt solid #CFE0DA;
  border-radius: 2.5mm;
  background: linear-gradient(180deg, #F2FAF7 0%, #FFFFFF 100%);
}
.weather__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2.5mm;
  margin-top: 2mm;
  font-size: 10pt;
}
.weather__grid span {
  padding: 2mm;
  border: 0.35pt solid #D8E6E2;
  border-radius: 1.75mm;
  background: #FFFFFF;
}
.src { margin: 1mm 0 0; font-size: 7.5pt; color: #5A6469; }
.impact { margin: 1.5mm 0 0; font-size: 9pt; }

/* Sections. break-inside stays AUTO on purpose: rows break one at a time
   (tr { break-inside: avoid }) with the header repeated by table-header-group,
   so a 30-crew labour table flows across pages instead of being shoved whole
   onto a fresh page — or breaking unpredictably when taller than one. */
.sect {
  margin-top: 5.5mm;
  break-inside: auto;
}
.sect .lbl {
  padding-bottom: 1.2mm;
  color: #1F5C33;
  border-bottom: 0.45pt solid #D8DAD6;
}
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th {
  padding: 1.6mm 1.6mm;
  border-top: 0;
  border-bottom: 0.6pt solid #BFC8C3;
  background: #EEF4F1;
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
  padding: 1.6mm 1.6mm;
  border-bottom: 0.4pt solid #D8DAD6;
  vertical-align: top;
}
tbody tr:nth-child(even) td { background: #FAFBF8; }
/* Right-aligned columns need room on their LEFT, not less on their right —
   zeroing the right padding ran every figure straight into the next column
   ("18.5040 MPa", "105Rain on the deck"). */
th.n, td.n { text-align: right; padding-left: 5mm; white-space: nowrap; }
th.k, td.k { white-space: nowrap; padding-right: 3mm; }
th.w, td.w { width: 40%; }
th:last-child, td:last-child { padding-right: 0; }
tfoot td {
  border-bottom: 0;
  border-top: 0.8pt solid #1F5C33;
  background: #F2FAF7;
  font-weight: 600;
  padding-top: 1.6mm;
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
  padding: 1.8mm 2.4mm;
  border-left: 2pt solid #131A1E;
  border-radius: 1.5mm;
  background: #F6F7F4;
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 8pt;
  letter-spacing: 0.06em;
}
.nil--gap {
  border-left-color: #A8730A;
  background: #FFF4D8;
  color: #A8730A;
}

.notes {
  margin: 1.5mm 0 0;
  padding: 2.5mm 3mm;
  background: #F8FAF7;
  border: 0.45pt solid #D8DAD6;
  border-left: 2pt solid #1F5C33;
  border-radius: 1.5mm;
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
  border-radius: 1.5mm;
}
.photos figcaption { margin-top: 1mm; font-size: 7.5pt; color: #5A6469; }

/* Drawn sign-off marks. */
.sig__drawn { display: flex; gap: 10mm; margin: 2mm 0 3mm; }
.sig__drawn figure { margin: 0; }
.sig__drawn img { height: 16mm; width: auto; display: block; border-bottom: 0.6pt solid #131A1E; }
.sig__drawn figcaption { margin-top: 1mm; font-size: 8.5pt; }
.sig__drawn figcaption .lbl { display: block; }

/* Signature */
.sig {
  margin-top: 6mm;
  padding: 4mm;
  border: 0.8pt solid #131A1E;
  border-radius: 2.5mm;
  background: #FFFFFF;
  break-inside: avoid;
}
.sig__grid { display: flex; gap: 12mm; margin-top: 2mm; }
.sig__grid p:not(.lbl) { margin: 0.5mm 0 0; font-size: 10pt; }
.hash {
  margin: 1mm 0 0;
  padding: 2mm;
  border: 0.35pt dashed #AEB6B2;
  border-radius: 1.5mm;
  background: #FAFBF8;
  font-size: 8.5pt;
  word-break: break-all;
  letter-spacing: 0.02em;
}

/* On screen the docket sits on a sheet of paper. On anything narrower than
   the paper, the sheet fits the screen instead of cropping — the PDF is the
   fixed-format artifact; the screen view answers "what does it say". */
@media screen {
  body {
    background:
      linear-gradient(rgba(19, 26, 30, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(19, 26, 30, 0.025) 1px, transparent 1px),
      linear-gradient(180deg, #F5F7F3 0%, #E8EEE9 54%, #DCE5E0 100%);
    background-size: 8mm 8mm, 8mm 8mm, auto;
    padding: 8mm 0;
  }
  .docket {
    width: min(210mm, 100%);
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 14mm 16mm;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 251, 248, 0.98)),
      #FFFFFF;
    border-radius: 3mm;
    box-shadow: 0 1mm 2mm rgba(19, 26, 30, 0.08), 0 10mm 28mm rgba(19, 26, 30, 0.16);
  }
}

@media screen and (max-width: 830px) {
  body { padding: 0; }
  .docket { min-height: 0; padding: 7mm 5mm 10mm; border-radius: 0; box-shadow: none; }
  .head { margin: -2mm -2mm 0; padding: 5mm; }
  .weather__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm; font-size: 9pt; }
  th.w, td.w { width: auto; }
  table { display: block; overflow-x: auto; }
}
`;
