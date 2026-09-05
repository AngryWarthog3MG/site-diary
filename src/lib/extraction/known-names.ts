import type { ExtractionProposal } from './schema.ts';
import { STANDARD_DAY_START } from './completeness.ts';

/**
 * The names a job answers to.
 *
 * The recording says "Marcus did eight hours" or "the excavator was on all
 * day". The crew and plant lists know who and what that is. This step —
 * deterministic, in code, after extraction — puts the listed name on the
 * row, fills the role or the hire type the list knows, and when hours were
 * stated but no times, lays the hours out from the standard start: eight
 * hours from 06:30 is 06:30 to 14:30. Nothing here invents a number the
 * recording did not carry; it only says whose number it is and where in
 * the day it sits. The supervisor still confirms every row at signing.
 *
 * Matching is deliberate and narrow: exact name, a listed alias, or a first
 * name that only one listed person has. Two Marcuses on a job stay as said.
 */

export interface KnownPerson {
  name: string;
  role: string | null;
  aliases: string[];
}

export interface KnownPlant {
  item: string;
  hire_type: string | null;
  supplier: string | null;
  aliases: string[];
}

const norm = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function matchPerson(said: string, crew: KnownPerson[]): KnownPerson | null {
  const s = norm(said);
  if (!s) return null;
  const exact = crew.filter((c) => norm(c.name) === s || c.aliases.some((a) => norm(a) === s));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const first = crew.filter((c) => norm(c.name).split(' ')[0] === s);
  return first.length === 1 ? first[0] : null;
}

function matchPlant(said: string, plant: KnownPlant[]): KnownPlant | null {
  const s = norm(said);
  if (!s) return null;
  const exact = plant.filter((p) => norm(p.item) === s || p.aliases.some((a) => norm(a) === s));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // "excavator" against "1.8t Excavator": a listed item that contains what
  // was said, if exactly one does.
  const within = plant.filter((p) => norm(p.item).includes(s) || p.aliases.some((a) => norm(a).includes(s)));
  return within.length === 1 ? within[0] : null;
}

/** "06:30" plus hours (and a break) as "HH:MM", wrapping past midnight. */
export function finishFrom(start: string, hours: number, breakMins = 0): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(start);
  if (!m) return start;
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(hours * 60) + breakMins;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function applyKnownNames(
  proposal: ExtractionProposal,
  crew: KnownPerson[],
  plant: KnownPlant[],
): { proposal: ExtractionProposal; matched: number } {
  let matched = 0;

  const labour = proposal.labour.map((person) => {
    const known = person.person_name ? matchPerson(String(person.person_name), crew) : null;
    let next = { ...person };
    if (known) {
      matched += 1;
      next = { ...next, person_name: known.name, role: next.role ?? known.role };
    }
    // Hours were said, times were not: lay the hours out from the standard
    // start. A stated time is never touched.
    if (next.hours != null && next.start_time == null && next.finish_time == null) {
      next = {
        ...next,
        start_time: STANDARD_DAY_START,
        finish_time: finishFrom(STANDARD_DAY_START, Number(next.hours), Number(next.break_mins ?? 0)),
      };
    }
    return next;
  });

  const plantRows = proposal.plant.map((row) => {
    const known = row.item ? matchPlant(String(row.item), plant) : null;
    if (!known) return row;
    matched += 1;
    const hire = known.hire_type === 'wet' || known.hire_type === 'dry' ? known.hire_type : null;
    return {
      ...row,
      item: known.item,
      hire_type: row.hire_type ?? hire,
      supplier: row.supplier ?? known.supplier,
    };
  });

  return { proposal: { ...proposal, labour, plant: plantRows }, matched };
}
