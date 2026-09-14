// Relative on purpose: this module is unit-tested under plain Node, which has no '@/' alias.
import { TICKET_TYPES, TICKET_LABEL, normaliseName, type TicketFacts } from '../crew/tickets.ts';

/**
 * The training matrix as facts: people down the side, competencies across,
 * each cell current, expiring, expired or missing — and required or not for
 * that person's role. Pure; the screen, the PDF and the digest read it.
 */

export interface Competency { key: string; label: string; custom: boolean; validMonths?: number | null; retired?: boolean }

/** The fixed ticket types plus the company's own, custom ones last. */
export function competencies(custom: ReadonlyArray<{ key: string; label: string; valid_months?: number | null; active?: boolean }>): Competency[] {
  const fixed = TICKET_TYPES.filter((t) => t !== 'other').map((t) => ({ key: t, label: TICKET_LABEL[t], custom: false }));
  // Retired custom competencies stay in the list (marked) so a requirement that
  // still names one keeps showing its gap rather than vanishing.
  return [...fixed, ...custom.map((c) => ({ key: c.key, label: c.active === false ? `${c.label} (retired)` : c.label, custom: true, validMonths: c.valid_months ?? null, retired: c.active === false }))];
}

export type CellState = 'current' | 'expiring' | 'expired' | 'missing';
export interface Cell { state: CellState; required: boolean; expires_on: string | null }

export interface PersonRecords { name: string; role: string | null; roles: string[]; tickets: Array<TicketFacts & { issued_on?: string | null }> }

function addDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10);
}

/** A ticket's effective expiry: as recorded, else issued + the competency's validity, else none. */
export function effectiveExpiry(t: TicketFacts & { issued_on?: string | null }, validMonths?: number | null): string | null {
  if (t.expires_on) return t.expires_on;
  if (validMonths && t.issued_on) return addMonths(t.issued_on, validMonths);
  return null;
}

export function cellFor(tickets: ReadonlyArray<TicketFacts & { issued_on?: string | null }>, key: string, required: boolean, today: string, horizonDays = 30, validMonths?: number | null): Cell {
  const held = tickets.filter((t) => t.active && t.ticket_type === key).map((t) => ({ ...t, expires_on: effectiveExpiry(t, validMonths) }));
  if (held.length === 0) return { state: 'missing', required, expires_on: null };
  const best = held.reduce((a, b) => (a.expires_on == null ? a : b.expires_on == null ? b : a.expires_on >= b.expires_on ? a : b));
  if (best.expires_on != null && best.expires_on < today) return { state: 'expired', required, expires_on: best.expires_on };
  if (best.expires_on != null && best.expires_on <= addDays(today, horizonDays)) return { state: 'expiring', required, expires_on: best.expires_on };
  return { state: 'current', required, expires_on: best.expires_on };
}

export interface MatrixRow { name: string; role: string | null; roles: string[]; cells: Record<string, Cell>; gaps: string[]; expiring: string[] }

/** Required competencies for the roles a person carries (one name may hold different roles on different jobs — all apply). */
export function requiredFor(roles: readonly string[], requirements: ReadonlyArray<{ role: string; competency: string }>): Set<string> {
  const keys = new Set(roles.map((r) => r.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
  return new Set(requirements.filter((q) => keys.has(q.role)).map((q) => q.competency));
}

export function buildMatrix(
  people: readonly PersonRecords[],
  comps: readonly Competency[],
  requirements: ReadonlyArray<{ role: string; competency: string }>,
  today: string,
): { rows: MatrixRow[]; columns: Competency[] } {
  const rows = people
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const req = requiredFor(p.roles, requirements);
      const cells: Record<string, Cell> = {};
      for (const c of comps) cells[c.key] = cellFor(p.tickets, c.key, req.has(c.key), today, 30, c.validMonths);
      const gaps = comps.filter((c) => cells[c.key].required && (cells[c.key].state === 'missing' || cells[c.key].state === 'expired')).map((c) => c.label);
      const expiring = comps.filter((c) => cells[c.key].state === 'expiring').map((c) => c.label);
      return { name: p.name, role: p.roles.length > 1 ? p.roles.join(' / ') : p.role, roles: p.roles, cells, gaps, expiring };
    });
  // Columns: anything required of anyone, or held by anyone. Empty columns clutter.
  const used = new Set<string>();
  for (const r of rows) for (const [k, c] of Object.entries(r.cells)) if (c.required || c.state !== 'missing') used.add(k);
  return { rows, columns: comps.filter((c) => used.has(c.key)) };
}

/** People from every source, merged by name: the crew lists and whoever holds a ticket. */
export function mergePeople(crew: ReadonlyArray<{ name: string; role: string | null }>, tickets: ReadonlyArray<TicketFacts & { person_name: string }>): PersonRecords[] {
  const byKey = new Map<string, PersonRecords>();
  for (const c of crew) {
    const k = normaliseName(c.name);
    const existing = byKey.get(k);
    const role = c.role?.trim() || null;
    if (existing) { if (role && !existing.roles.some((r) => r.toLowerCase() === role.toLowerCase())) existing.roles.push(role); if (!existing.role) existing.role = role; continue; }
    byKey.set(k, { name: c.name, role, roles: role ? [role] : [], tickets: [] });
  }
  for (const t of tickets) {
    const k = normaliseName(t.person_name);
    if (!byKey.has(k)) byKey.set(k, { name: t.person_name, role: null, roles: [], tickets: [] });
    byKey.get(k)!.tickets.push(t);
  }
  return [...byKey.values()];
}
