import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';

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
        <p className="notes">{data.summary}</p>
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
.talkgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm 8mm; margin-top: 2mm; }
.talkgrid figure { margin: 0; break-inside: avoid; }
.talkgrid img { height: 14mm; width: auto; max-width: 100%; display: block; border-bottom: 0.6pt solid #131A1E; background: #fff; }
.talkgrid figcaption { margin-top: 1mm; font-size: 8.5pt; }
`;
