import type { PlantKind } from '@/lib/plant/checklist';

/**
 * Tickets: what a person holds, and what a machine needs.
 *
 * The plant prestart asks "does this operator's recorded paperwork cover this
 * machine?" and answers from facts alone. Three answers matter: covered, not
 * covered (missing or expired — the machine does not start), and nothing
 * recorded for this person at all, which is a warning and a job for the
 * office, not a reason to stop work on the strength of an empty list.
 */
export const TICKET_TYPES = [
  'white_card', 'c_licence', 'mr_licence', 'hr_licence', 'hc_licence',
  'excavator', 'roller', 'loader', 'forklift', 'ewp', 'first_aid',
  'working_at_heights', 'confined_space', 'traffic_control', 'chainsaw', 'other',
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_LABEL: Record<TicketType, string> = {
  white_card: 'White card',
  c_licence: 'Driver licence (C)',
  mr_licence: 'Medium rigid licence (MR)',
  hr_licence: 'Heavy rigid licence (HR)',
  hc_licence: 'Heavy combination licence (HC)',
  excavator: 'Excavator ticket / VOC',
  roller: 'Roller ticket / VOC',
  loader: 'Loader ticket / VOC',
  forklift: 'Forklift licence (LF)',
  ewp: 'EWP ticket',
  first_aid: 'First aid',
  working_at_heights: 'Working at heights',
  confined_space: 'Confined space',
  traffic_control: 'Traffic control',
  chainsaw: 'Chainsaw',
  other: 'Other',
};

/** Any one of these covers the machine. */
export const REQUIRED_TICKETS: Record<PlantKind, TicketType[]> = {
  excavator: ['excavator'],
  roller: ['roller'],
  vac_truck: ['mr_licence', 'hr_licence', 'hc_licence'],
  truck: ['c_licence', 'mr_licence', 'hr_licence', 'hc_licence'],
  vac_trailer: ['c_licence', 'mr_licence', 'hr_licence', 'hc_licence'],
  small_plant: [],
  other: [],
};

export interface TicketFacts { ticket_type: string; expires_on: string | null; active: boolean }

export type TicketVerdict =
  | { kind: 'not_needed' }
  | { kind: 'covered'; by: TicketType; expires: string | null }
  | { kind: 'none_recorded' }
  | { kind: 'expired'; by: TicketType; expired: string }
  | { kind: 'missing'; needs: TicketType[] };

export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ticketVerdict(kind: PlantKind, tickets: TicketFacts[], today: string): TicketVerdict {
  const needs = REQUIRED_TICKETS[kind];
  if (needs.length === 0) return { kind: 'not_needed' };
  const held = tickets.filter((t) => t.active);
  if (held.length === 0) return { kind: 'none_recorded' };
  const relevant = held.filter((t) => (needs as string[]).includes(t.ticket_type));
  const current = relevant.find((t) => !t.expires_on || t.expires_on >= today);
  if (current) return { kind: 'covered', by: current.ticket_type as TicketType, expires: current.expires_on };
  const lapsed = relevant.sort((a, b) => (b.expires_on ?? '').localeCompare(a.expires_on ?? ''))[0];
  if (lapsed) return { kind: 'expired', by: lapsed.ticket_type as TicketType, expired: lapsed.expires_on ?? '' };
  return { kind: 'missing', needs };
}

/** For the nightly digest: what lapses within `days`, and what already has. */
export function expiring(tickets: Array<TicketFacts & { person_name: string }>, today: string, days = 30) {
  const horizon = new Date(`${today}T00:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + days);
  const limit = horizon.toISOString().slice(0, 10);
  const expired = tickets.filter((t) => t.active && t.expires_on && t.expires_on < today);
  const soon = tickets.filter((t) => t.active && t.expires_on && t.expires_on >= today && t.expires_on <= limit);
  return { expired, soon };
}
