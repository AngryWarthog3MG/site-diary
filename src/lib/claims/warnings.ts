/**
 * What the register is quietly getting wrong about a variation's money.
 *
 * `waitingOn` already says "Put a value on it" when there is no value — but a
 * blank cost box saves as 0, not null, and 0 is a value as far as arithmetic
 * is concerned. Curtin's V-001 sat "priced" at $0 with eighty-four hours of
 * vac trailer and crew recorded against it, and nothing in the app said a
 * word. That is the whole variation, unclaimed (README R85).
 *
 * These are warnings, not gaps: nothing here refuses anything. A variation
 * genuinely worth nothing is allowed — it just has to be a variation with no
 * work behind it, because a day of work is never worth nothing.
 *
 * Pure, relative imports only.
 */
import { itemValue } from './register.ts';

export type RegisterWarningKind = 'priced_at_nothing' | 'hours_not_recorded';

export interface RegisterWarning {
  kind: RegisterWarningKind;
  /** What is wrong, in the words a PM would use. */
  text: string;
  /** What to do about it. */
  fix: string;
}

type Item = {
  estimated_cost: number | null;
  agreed_cost: number | null;
  hours: number;
  mentions: ReadonlyArray<{ date: string; hours: number | null }>;
};

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function registerWarnings(item: Item): RegisterWarning[] {
  const out: RegisterWarning[] = [];
  const days = item.mentions.length;

  // Valued at nothing, with work behind it. Null is someone who has not got to
  // it yet and the tracker already says so; 0 is the register believing them.
  if (days > 0 && itemValue(item) === 0) {
    const behind = item.hours > 0
      ? `${hrs(item.hours)} hours over ${plural(days, 'day')}`
      : plural(days, 'day');
    out.push({
      kind: 'priced_at_nothing',
      text: `Valued at nothing, with ${behind} recorded against it.`,
      fix: 'Put the real figure in — an empty cost box saves as zero, and the register believes it.',
    });
  }

  // Days recorded against it that state no hours. They are not counted in the
  // total, so the claim reads short by however many they were.
  const blank = item.mentions.filter((m) => m.hours == null);
  if (blank.length > 0) {
    out.push({
      kind: 'hours_not_recorded',
      text: `${blank.length} of ${plural(days, 'day')} carry no hours: ${blank.map((m) => fmt(m.date)).join(', ')}.`,
      fix: 'Hours nobody recorded are not in the total, so the claim reads short. A signed day takes a correction.',
    });
  }
  return out;
}

function fmt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/** Every variation with something wrong, worst first — the home card's list. */
export function registerWarningCount<T extends Item>(items: readonly T[]): number {
  return items.filter((i) => registerWarnings(i).length > 0).length;
}
