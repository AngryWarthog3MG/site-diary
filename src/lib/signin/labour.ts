import { awstClock } from './register.ts';
import { workedHours } from '../review/hours.ts';

/**
 * The gate feeds the diary's labour list. A person who signed in at the gate
 * is a labour row with the clocks the gate saw; when they sign out, the finish
 * and the hours follow. The row stays the gate's until the supervisor touches
 * a clock on it — from then on it is theirs, and the gate leaves it alone. A
 * row typed by hand or heard in the recording is never overwritten: the gate
 * only fills what is still blank on it.
 *
 * Provenance rides in `source_quote`: a gate row's quote starts with
 * `GATE_PREFIX` and says what the gate saw; a hand-edited one keeps the story
 * but drops the prefix, so it no longer updates. Pure, Node-tested.
 */
export const GATE_PREFIX = 'Gate:';
export const GATE_EDITED = 'From the gate, then edited by hand';

export interface GateSignIn {
  person_name: string;
  company: string | null;
  person_kind: string;
  signed_in_at: string;
  signed_in_on_device_at: string;
  signed_out_at: string | null;
  signed_out_on_device_at: string | null;
}

export interface LabourItem {
  person_name: string;
  role?: string | null;
  area?: string | null;
  start_time?: string | null;
  finish_time?: string | null;
  break_mins?: number | null;
  hours?: number | null;
  overtime_hours?: number | null;
  source_quote?: string | null;
  confidence?: string | null;
  [key: string]: unknown;
}

export const normaliseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function fromGate(item: { source_quote?: unknown }): boolean {
  return typeof item.source_quote === 'string' && item.source_quote.startsWith(GATE_PREFIX);
}

/** The fields the gate owns. Touching one of these by hand hands the row over. */
export const GATE_CLOCK_FIELDS = new Set(['start_time', 'finish_time', 'hours']);

interface GateDay { name: string; role: string | null; start: string; finish: string | null; quote: string }

/**
 * One person may pass the gate more than once in a day. Their labour is the
 * first arrival to the last departure; still on site if any pass is open.
 */
export function gateDays(signins: readonly GateSignIn[], roles: ReadonlyMap<string, string | null>): GateDay[] {
  const byName = new Map<string, { name: string; company: string | null; ins: string[]; outs: string[]; open: boolean }>();
  for (const s of signins) {
    if (s.person_kind !== 'crew' && s.person_kind !== 'subcontractor') continue;
    const key = normaliseName(s.person_name);
    const cur = byName.get(key) ?? { name: s.person_name.trim(), company: s.company, ins: [], outs: [], open: false };
    cur.ins.push(s.signed_in_on_device_at ?? s.signed_in_at);
    const out = s.signed_out_on_device_at ?? s.signed_out_at;
    if (out) cur.outs.push(out); else cur.open = true;
    byName.set(key, cur);
  }
  return [...byName.entries()].map(([key, p]) => {
    const start = awstClock(p.ins.sort()[0]);
    const finish = p.open || p.outs.length === 0 ? null : awstClock(p.outs.sort().at(-1));
    const role = roles.get(key) ?? (p.company ? `${p.company} · signed in` : null);
    const quote = `${GATE_PREFIX} in ${start}${finish ? ` · out ${finish}` : ' · still on site'}`;
    return { name: p.name, role, start, finish, quote };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

/**
 * Fold the gate's day into the labour list. Returns the same array when
 * nothing would change, so the caller can tell and the autosave stays quiet.
 */
export function mergeGateIntoLabour<T extends LabourItem>(
  items: readonly T[],
  signins: readonly GateSignIn[],
  roles: ReadonlyMap<string, string | null>,
): { items: T[]; changed: boolean } {
  const days = gateDays(signins, roles);
  if (days.length === 0) return { items: items as T[], changed: false };
  const out = items.slice() as T[];
  let changed = false;
  const index = new Map<string, number>();
  out.forEach((it, i) => { if (typeof it.person_name === 'string' && it.person_name.trim()) index.set(normaliseName(it.person_name), i); });

  for (const d of days) {
    const key = normaliseName(d.name);
    const at = index.get(key);
    if (at == null) {
      out.push({
        person_name: d.name, role: d.role, area: null,
        start_time: d.start, finish_time: d.finish, break_mins: null,
        hours: workedHours(d.start, d.finish, null),
        overtime_hours: null, source_quote: d.quote, confidence: null,
      } as unknown as T);
      index.set(key, out.length - 1);
      changed = true;
      continue;
    }
    const row = out[at];
    if (fromGate(row)) {
      // The gate's row: the clocks follow the gate; the break is the supervisor's.
      const hours = workedHours(d.start, d.finish, row.break_mins ?? null);
      const next = { ...row, start_time: d.start, finish_time: d.finish, hours, source_quote: d.quote, role: row.role ?? d.role };
      if (next.start_time !== row.start_time || next.finish_time !== row.finish_time || next.hours !== row.hours || next.source_quote !== row.source_quote || next.role !== row.role) {
        out[at] = next; changed = true;
      }
      continue;
    }
    // Someone else's row: fill only what is blank, and only with what the gate has.
    const patch: Partial<LabourItem> = {};
    if (row.start_time == null) patch.start_time = d.start;
    if (row.finish_time == null && row.hours == null && d.finish) patch.finish_time = d.finish;
    if (Object.keys(patch).length === 0) continue;
    const merged = { ...row, ...patch };
    const hours = workedHours(merged.start_time, merged.finish_time, merged.break_mins ?? null);
    if (row.hours == null && hours != null) merged.hours = hours;
    if (row.role == null && d.role) merged.role = d.role;
    out[at] = merged as T; changed = true;
  }
  return changed ? { items: out, changed } : { items: items as T[], changed: false };
}
