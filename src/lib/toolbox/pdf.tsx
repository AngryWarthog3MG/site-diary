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

/**
 * A talk worth signing onto runs to more than one paragraph, so the summary
 * is laid out rather than dumped: blank lines separate blocks, a line ending
 * in a colon is a heading for the block under it, and a line opening with
 * "- " is a point in a list. Nothing is interpreted beyond that — the words
 * printed are the words the supervisor wrote.
 */
function summaryBlocks(summary: string): ReactElement[] {
  const blocks: ReactElement[] = [];
  const chunks = summary.replace(/\r\n/g, '\n').split(/\n\s*\n/);

  chunks.forEach((chunk, index) => {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;

    if (lines[0].endsWith(':') && lines.length > 1) {
      blocks.push(
        <p key={`h${index}`} className="talkhead">
          {lines[0].slice(0, -1)}
        </p>,
      );
      lines.shift();
    }

    // A block can mix the two: a sentence or two of setup, then the points.
    // Take them in runs so a "- " never ends up printed mid-paragraph.
    let run: string[] = [];
    let runIsList = false;
    const flush = (key: string) => {
      if (run.length === 0) return;
      blocks.push(
        runIsList ? (
          <ul key={key} className="talkpoints">
            {run.map((line, i) => (
              <li key={i}>{line.slice(2)}</li>
            ))}
          </ul>
        ) : (
          <p key={key} className="talkpara">
            {run.join(' ')}
          </p>
        ),
      );
      run = [];
    };

    lines.forEach((line, i) => {
      const isBullet = line.startsWith('- ');
      if (run.length > 0 && isBullet !== runIsList) flush(`${index}-${i}`);
      runIsList = isBullet;
      run.push(line);
    });
    flush(`${index}-end`);
  });

  return blocks;
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
