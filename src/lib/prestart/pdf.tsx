import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { parseTalkSummary } from '@/lib/toolbox/summary';
import { PRESTART_CHECKS, type ChecklistState } from './checklist';

/**
 * The prestart as a document: what was on, what could hurt someone, the
 * checks, and every signature. Same dress and archival rules as the docket
 * and the toolbox talk — embedded fonts, embedded frog, embedded ink.
 */

export interface PrestartPdfData {
  orgName: string;
  orgCode: string;
  projectName: string;
  projectCode: string;
  date: string;
  supervisor: string;
  workPlanned: string;
  hazards: string;
  plant: string | null;
  permits: string | null;
  notes: string | null;
  checklist: ChecklistState;
  completedAtAwst: string;
  attendees: Array<{ name: string; fit: boolean; src: string }>;
}

function blocks(text: string): ReactElement[] {
  return parseTalkSummary(text).map((block, i) => {
    if (block.kind === 'heading') return <p key={i} className="talkhead">{block.text}</p>;
    if (block.kind === 'points') {
      return (
        <ul key={i} className="talkpoints">
          {block.items.map((item, j) => <li key={j}>{item}</li>)}
        </ul>
      );
    }
    return <p key={i} className="talkpara">{block.text}</p>;
  });
}

export function PrestartDoc({ data }: { data: PrestartPdfData }): ReactElement {
  const notFit = data.attendees.filter((a) => !a.fit).length;
  return (
    <div className="docket">
      <header className="head">
        <div className="head__left">
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}
          </p>
          <h1>Prestart</h1>
          <p className="mono sub">
            {data.projectName} · {data.orgCode}_{data.projectCode}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">Daily prestart</p>
          <p className="mono serial">{data.date}</p>
          <p className="mono sub">Run by {data.supervisor}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">What is on today</p>
        <div className="talkbody">{blocks(data.workPlanned)}</div>
      </section>

      <section className="sect">
        <p className="lbl">Hazards and controls</p>
        <div className="talkbody">{blocks(data.hazards)}</div>
      </section>

      {data.plant && (
        <section className="sect">
          <p className="lbl">Plant on site</p>
          <div className="talkbody">{blocks(data.plant)}</div>
        </section>
      )}

      {data.permits && (
        <section className="sect">
          <p className="lbl">Permits</p>
          <div className="talkbody">{blocks(data.permits)}</div>
        </section>
      )}

      <section className="sect">
        <p className="lbl">Checks</p>
        <ul className="checks">
          {PRESTART_CHECKS.map((item) => {
            const yes = Boolean(data.checklist[item.key]);
            return (
              <li key={item.key} className={yes ? 'checks__yes' : 'checks__no'}>
                <span className="checks__mark" aria-hidden />
                <span>{item.label}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {data.notes && (
        <section className="sect">
          <p className="lbl">Notes</p>
          <div className="talkbody">{blocks(data.notes)}</div>
        </section>
      )}

      <section className="sect">
        <p className="lbl">
          Attendance · {data.attendees.length} signed on
          {notFit > 0 ? ` · ${notFit} declared not fit for work` : ''}
        </p>
        <div className="talkgrid">
          {data.attendees.map((attendee, i) => (
            <figure key={i} className={attendee.fit ? '' : 'talkgrid__notfit'}>
              <img src={attendee.src} alt="" />
              <figcaption>
                {attendee.name}
                {!attendee.fit && <span className="notfit"> · NOT FIT FOR WORK</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="sig">
        <p className="lbl">Record</p>
        <p className="src">
          Prestart finished {data.completedAtAwst}. This is a frozen record: the briefing,
          the checks and the signatures above cannot be altered. Kooboolong Services Pty Ltd.
        </p>
      </section>
    </div>
  );
}

export const PRESTART_CSS = `
.talkbody { margin-top: 2mm; }
.talkhead { margin: 4mm 0 1mm; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #2E6B4F; break-after: avoid; }
.talkbody > .talkhead:first-child { margin-top: 0; }
.talkpara { margin: 0 0 2mm; font-size: 9.5pt; line-height: 1.5; }
.talkpoints { margin: 0 0 2mm; padding-left: 4.5mm; font-size: 9.5pt; line-height: 1.5; }
.talkpoints li { margin-bottom: 0.8mm; }
.checks { list-style: none; margin: 2mm 0 0; padding: 0; columns: 2; column-gap: 8mm; font-size: 9pt; }
.checks li { display: flex; gap: 2.2mm; align-items: flex-start; margin-bottom: 1.6mm; break-inside: avoid; }
/* Drawn, not typed: the embedded print face has no tick or cross glyph, and
   a box that is filled or empty reads the same on paper as on the phone. */
.checks__mark { flex: 0 0 auto; position: relative; display: inline-block; width: 3.6mm; height: 3.6mm;
  margin-top: 0.5mm; border: 0.5pt solid #131A1E; border-radius: 0.6mm; background: #fff; }
.checks__yes .checks__mark { background: #2E6B4F; border-color: #2E6B4F; }
.checks__yes .checks__mark::after { content: ''; position: absolute; left: 1.15mm; top: 0.35mm; width: 0.9mm; height: 1.9mm;
  border: solid #fff; border-width: 0 0.5mm 0.5mm 0; transform: rotate(45deg); }
.checks__no .checks__mark { border-color: #9A2F2F; }
.checks__no .checks__mark::before, .checks__no .checks__mark::after { content: ''; position: absolute; left: 0.55mm; top: 1.55mm;
  width: 2.3mm; height: 0.45mm; background: #9A2F2F; transform: rotate(45deg); }
.checks__no .checks__mark::after { transform: rotate(-45deg); }
.talkgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm 8mm; margin-top: 2mm; }
.talkgrid figure { margin: 0; break-inside: avoid; }
.talkgrid img { height: 14mm; width: auto; max-width: 100%; display: block; border-bottom: 0.6pt solid #131A1E; background: #fff; }
.talkgrid figcaption { margin-top: 1mm; font-size: 8.5pt; }
.notfit { color: #9A2F2F; font-weight: 700; font-size: 7.5pt; }
`;
