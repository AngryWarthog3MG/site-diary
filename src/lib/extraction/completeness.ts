import {
  SECTION_KEYS,
  type ExtractionProposal,
  type SectionKey,
  type SectionOutcome,
} from './schema.ts';

/**
 * The completeness check (brief §4) and the blocking gaps, both deterministic.
 *
 * Nothing here asks the model anything. The follow-up questions are fixed
 * templates and the reconciliation is arithmetic, because a supervisor being
 * asked "nothing on plant today, is that right?" should get the same question
 * every time, and because the answer to "did the model contradict itself"
 * must not itself come from the model.
 */

/** Fixed wording. A prompt on a screen at knock-off is not the place for variety. */
const QUESTIONS: Record<SectionKey, string> = {
  labour: 'Nobody recorded on labour today — is that right?',
  plant: 'Nothing on plant today — is that right?',
  work_items: 'Nothing recorded as completed today — is that right?',
  variations: 'No variations today — is that right?',
  delays: 'No delays today — is that right?',
  weather: 'Did the weather affect the work today?',
};

export interface FollowUp {
  section: SectionKey;
  question: string;
}

/** How many extracted items a section actually has. */
export function itemCount(proposal: ExtractionProposal, section: SectionKey): number {
  switch (section) {
    case 'labour':
      return proposal.labour.length;
    case 'plant':
      return proposal.plant.length;
    case 'work_items':
      return proposal.work_items.length;
    case 'variations':
      return proposal.variations.length;
    case 'delays':
      return proposal.delays.length;
    case 'weather':
      return proposal.weather_impact ? 1 : 0;
  }
}

export interface Reconciliation {
  proposal: ExtractionProposal;
  corrections: string[];
}

/**
 * Make the declared section states agree with what was actually extracted.
 *
 * A model that lists three workers and then calls labour a gap, or calls plant
 * captured with nothing in it, has contradicted itself. The items are the
 * evidence and the state is the claim, so the items win. `nil_confirmed` is
 * never overridden on an empty section — that is the supervisor's own answer
 * and the whole point of the distinction.
 */
export function reconcileSections(input: ExtractionProposal): Reconciliation {
  const corrections: string[] = [];
  const sections = { ...input.sections };

  for (const section of SECTION_KEYS) {
    const outcome: SectionOutcome = sections[section];
    const count = itemCount(input, section);

    if (count > 0 && outcome.state !== 'captured') {
      corrections.push(
        `${section}: ${count} item${count === 1 ? '' : 's'} extracted but marked ${outcome.state}`,
      );
      sections[section] = { ...outcome, state: 'captured' };
      continue;
    }

    if (count === 0 && outcome.state === 'captured') {
      corrections.push(`${section}: marked captured with nothing extracted`);
      sections[section] = { ...outcome, state: 'gap' };
    }
  }

  return { proposal: { ...input, sections }, corrections };
}

/**
 * One question per unanswered section (§4). A section the supervisor
 * explicitly nilled is answered and is not asked about again.
 */
export function followUpQuestions(proposal: ExtractionProposal): FollowUp[] {
  return SECTION_KEYS.filter((section) => proposal.sections[section].state === 'gap').map(
    (section) => ({ section, question: QUESTIONS[section] }),
  );
}

/**
 * The blocking gates, evaluated against a proposal rather than the database,
 * so the review screen can show them before anything is applied. Codes match
 * `app.entry_blocking_gaps()` so the two never disagree. A variation photo is
 * optional (owner decision, 2026-08-27); the VR reference is not.
 */
export function proposalBlockingGaps(proposal: ExtractionProposal): string[] {
  const gaps = new Set<string>();

  for (const variation of proposal.variations) {
    if (!variation.vr_ref?.trim()) gaps.add('variation_missing_vr_ref');
  }
  for (const pour of proposal.pours) {
    if (pour.volume_m3 == null) gaps.add('pour_missing_volume_m3');
  }
  for (const delay of proposal.delays) {
    if (delay.start_time == null || delay.end_time == null) gaps.add('delay_missing_times');
  }

  return [...gaps].sort();
}

/** Items the review screen should pre-flag (§4). */
export function lowConfidenceCount(proposal: ExtractionProposal): number {
  const groups = [
    proposal.labour,
    proposal.plant,
    proposal.work_items,
    proposal.variations,
    proposal.delays,
    proposal.pours,
    proposal.quantities,
  ];
  return groups.reduce(
    (total, items) => total + items.filter((i) => i.confidence === 'low').length,
    0,
  );
}

/**
 * Site policy: the standard day runs 06:30 to 16:30 — ten hours, no break
 * assumed. The owner set 07:00 and eight hours on 2026-08-27 and changed it
 * to these times on 2026-09-05; the crew work them, and a break is entered
 * when one is taken rather than assumed away.
 *
 * The owner's original reasoning still holds: asking a supervisor to type
 * the same figure for every person every day was friction with no
 * information in it. So a person whose time nobody stated is filled with
 * the standard day here — deterministically, in code, after extraction —
 * and the supervisor still confirms every row at signing, which is what
 * keeps §2.4 honest: the number is a declared policy the signer vouches
 * for, not a model's guess.
 *
 * The model itself still never invents hours. It computes them only when a
 * finish time was actually said ("worked till 1" = 06:30 to 13:00 = 6.5),
 * and leaves them null otherwise — this fills the nulls.
 *
 * This is the one place the standard day is written down. The extraction
 * prompt and the entry screen's defaults both read from here.
 */
export const STANDARD_DAY_START = '06:30';
export const STANDARD_DAY_FINISH = '16:30';
export const STANDARD_DAY_HOURS = 10;

export function applyStandardDay(proposal: ExtractionProposal): {
  proposal: ExtractionProposal;
  defaulted: number;
} {
  let defaulted = 0;
  const labour = proposal.labour.map((person) => {
    if (person.hours != null) return person;
    defaulted += 1;
    // Nobody said anything about this person's time, so the standard day
    // stands for it — the times as well as the total, because a docket that
    // shows ten hours and no times invites the question a year later.
    // A stated time is never overwritten.
    return {
      ...person,
      hours: STANDARD_DAY_HOURS,
      start_time: person.start_time ?? STANDARD_DAY_START,
      finish_time: person.finish_time ?? STANDARD_DAY_FINISH,
    };
  });
  return { proposal: { ...proposal, labour }, defaulted };
}
