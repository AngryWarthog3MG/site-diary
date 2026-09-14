/**
 * The visitor gate as facts: how a code is made, where it points, and what
 * a visitor is asked to acknowledge when the site has not written its own.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A code long enough that nobody guesses it, short enough to read out. */
export function newGateToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(20);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function gateUrl(token: string, base = 'https://kbsdailydiary.me'): string {
  return `${base}/gate/${token}`;
}

export const DEFAULT_RULES = [
  'Report to the site supervisor before going past the gate.',
  'Wear the PPE the site requires: hard hat, hi-vis, safety boots, glasses where signed.',
  'Stay on the walkways and out of exclusion zones around plant and excavations.',
  'No alcohol or drugs. Tell the supervisor about any medical condition that affects your safety.',
  'Follow every instruction from site staff and leave the way you came in.',
  'Sign out when you leave — the register is the roll call in an emergency.',
].join('\n');

export const GATE_KINDS = ['visitor', 'subcontractor', 'delivery'] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export const GATE_KIND_LABEL: Record<GateKind, string> = { visitor: 'Visitor', subcontractor: 'Subcontractor', delivery: 'Delivery' };

/** What the public route accepts, checked before anything touches the record. */
export interface GateSignIn { name: string; company: string | null; kind: GateKind; contact: string | null; acknowledged: boolean }

export function validateGateSignIn(input: unknown): { ok: true; value: GateSignIn } | { ok: false; reason: string } {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 80) return { ok: false, reason: 'Your name, please.' };
  const kind = GATE_KINDS.includes(r.kind as GateKind) ? (r.kind as GateKind) : null;
  if (!kind) return { ok: false, reason: 'Say why you are here.' };
  const company = typeof r.company === 'string' && r.company.trim() ? r.company.trim().slice(0, 80) : null;
  const contact = typeof r.contact === 'string' && r.contact.trim() ? r.contact.trim().slice(0, 40) : null;
  if (r.acknowledged !== true) return { ok: false, reason: 'Read the site rules and tick that you accept them.' };
  return { ok: true, value: { name, company, kind, contact, acknowledged: true } };
}
