import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { parseTalkSummary } from './summary';

/**
 * The toolbox talk as a document: topic, what was covered, and every
 * attendee's drawn signature — the safety record a principal's auditor asks
 * for. Same dress and archival rules as the docket: embedded fonts, embedded
 * frog, embedded ink.
 */

export interface TalkPdfData {
  orgName: string;
  orgCode: string;
  projectName: string;
  projectCode: string;
  date: string;
  topic: string;
  summary: string;
  presenter: string;
  completedAtAwst: string;
  attendees: Array<{ name: string; src: string }>;
}

/** The parsed talk, dressed for print. The screen renders the same blocks. */
function summaryBlocks(summary: string): ReactElement[] {
  return parseTalkSummary(summary).map((block, i) => {
    if (block.kind === 'heading') {
      return (
        <p key={i} className="talkhead">
          {block.text}
        </p>
      );
    }
    if (block.kind === 'points') {
      return (
        <ul key={i} className="talkpoints">
          {block.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="talkpara">
        {block.text}
      </p>
    );
  });
}

export function ToolboxTalkDoc({ data }: { data: TalkPdfData }): ReactElement {
  return (
    <div className="docket">
      <header className="head">
        <div className="head__left">
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}
          </p>
          <h1>{data.topic}</h1>
          <p className="mono sub">
            {data.projectName} · {data.orgCode}_{data.projectCode}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">Toolbox talk</p>
          <p className="mono serial">{data.date}</p>
          <p className="mono sub">Presented by {data.presenter}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">What was covered</p>
        <div className="talkbody">{summaryBlocks(data.summary)}</div>
      </section>

      <section className="sect">
        <p className="lbl">Attendance · {data.attendees.length} signed on</p>
        <div className="talkgrid">
          {data.attendees.map((attendee) => (
            <figure key={attendee.name + attendee.src.length}>
              <img src={attendee.src} alt="" />
              <figcaption>{attendee.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="sig">
        <p className="lbl">Record</p>
        <p className="src">
          Conducted and completed {data.completedAtAwst}. This talk is a frozen record: the
          topic, summary and signatures above cannot be altered. Kooboolong Services Pty Ltd.
        </p>
      </section>
    </div>
  );
}

export const TALK_CSS = `
.talkbody { margin-top: 2mm; }
.talkhead { margin: 4mm 0 1mm; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #2E6B4F; break-after: avoid; }
.talkbody > .talkhead:first-child { margin-top: 0; }
.talkpara { margin: 0 0 2mm; font-size: 9.5pt; line-height: 1.5; }
.talkpoints { margin: 0 0 2mm; padding-left: 4.5mm; font-size: 9.5pt; line-height: 1.5; }
.talkpoints li { margin-bottom: 0.8mm; }
.talkgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm 8mm; margin-top: 2mm; }
.talkgrid figure { margin: 0; break-inside: avoid; }
.talkgrid img { height: 14mm; width: auto; max-width: 100%; display: block; border-bottom: 0.6pt solid #131A1E; background: #fff; }
.talkgrid figcaption { margin-top: 1mm; font-size: 8.5pt; }
`;
