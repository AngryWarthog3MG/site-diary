/**
 * The shape of a written talk.
 *
 * A talk worth signing onto runs to more than one paragraph, and it is read
 * aloud off a phone — so the screen and the PDF both need it laid out, and
 * they need to agree. This turns the supervisor's plain text into blocks;
 * each renderer dresses them its own way.
 *
 * The rules are deliberately few, because a supervisor typing on a phone at
 * 6:45am should not have to learn a syntax:
 *
 *   - a blank line starts a new block
 *   - a line ending in a colon, with more under it, is that block's heading
 *   - a line starting with "- " is a point
 *
 * Nothing else is interpreted. The words that print are the words that were
 * written.
 */

export type TalkBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'points'; items: string[] };

export function parseTalkSummary(summary: string): TalkBlock[] {
  const blocks: TalkBlock[] = [];

  for (const chunk of summary.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines[0].endsWith(':') && lines.length > 1) {
      blocks.push({ kind: 'heading', text: lines[0].slice(0, -1) });
      lines.shift();
    }

    // A block can mix the two: a sentence of setup, then the points. Take
    // them in runs so a "- " never ends up printed mid-paragraph.
    let run: string[] = [];
    let runIsPoints = false;
    const flush = () => {
      if (run.length === 0) return;
      blocks.push(
        runIsPoints
          ? { kind: 'points', items: run.map((line) => line.slice(2)) }
          : { kind: 'para', text: run.join(' ') },
      );
      run = [];
    };

    for (const line of lines) {
      const isPoint = line.startsWith('- ');
      if (run.length > 0 && isPoint !== runIsPoints) flush();
      runIsPoints = isPoint;
      run.push(line);
    }
    flush();
  }

  return blocks;
}
