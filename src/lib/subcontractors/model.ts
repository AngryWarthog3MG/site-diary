/**
 * Subcontractor compliance as facts: which documents a company needs to be
 * on site, and what its paperwork says today. Pure; the same verdict drives
 * the register badge, the gate flag and the nightly email.
 */

export const DOC_KINDS = ['public_liability', 'workers_comp', 'swms', 'licence', 'insurance_other', 'safety_plan', 'induction', 'other'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_LABEL: Record<DocKind, string> = {
  public_liability: 'Public liability insurance',
  workers_comp: "Workers' compensation insurance",
  swms: 'SWMS for their work',
  licence: 'Licence or registration',
  insurance_other: 'Other insurance',
  safety_plan: 'Safety management plan',
  induction: 'Company induction record',
  other: 'Other',
};

/** What a subcontractor must hold, current, to work on a job. */
export const REQUIRED_DOCS: readonly DocKind[] = ['public_liability', 'workers_comp', 'swms'];
/** Insurance always has a term: a certificate with no expiry recorded is not evidence of cover. */
export const NEEDS_EXPIRY: readonly DocKind[] = ['public_liability', 'workers_comp'];

export interface DocFacts { kind: DocKind; expires_on: string | null; active: boolean }

export type Verdict = 'compliant' | 'expiring' | 'lapsed' | 'missing' | 'none_recorded';
export const VERDICT_LABEL: Record<Verdict, string> = {
  compliant: 'Compliant', expiring: 'Expiring soon', lapsed: 'Lapsed', missing: 'Paperwork missing', none_recorded: 'No paperwork recorded',
};

export interface ComplianceResult {
  verdict: Verdict;
  /** Required kinds with no active, in-date document. */
  missing: DocKind[];
  /** Required kinds whose best document has expired. */
  lapsed: DocKind[];
  /** Required kinds whose best document expires within the horizon. */
  expiring: Array<{ kind: DocKind; expires_on: string }>;
}

function addDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

/** The verdict for one company from its documents, as of today, 30 days ahead. */
export function compliance(docs: readonly DocFacts[], today: string, horizonDays = 30): ComplianceResult {
  const active = docs.filter((d) => d.active);
  if (active.length === 0) return { verdict: 'none_recorded', missing: [...REQUIRED_DOCS], lapsed: [], expiring: [] };
  const limit = addDays(today, horizonDays);
  const missing: DocKind[] = []; const lapsed: DocKind[] = []; const expiring: ComplianceResult['expiring'] = [];
  for (const kind of REQUIRED_DOCS) {
    const ofKind = active.filter((d) => d.kind === kind && !(NEEDS_EXPIRY.includes(kind) && d.expires_on == null));
    if (ofKind.length === 0) { missing.push(kind); continue; }
    // The best document is the one that lasts longest; no expiry lasts forever.
    const best = ofKind.reduce((a, b) => (a.expires_on == null ? a : b.expires_on == null ? b : a.expires_on >= b.expires_on ? a : b));
    if (best.expires_on != null && best.expires_on < today) lapsed.push(kind);
    else if (best.expires_on != null && best.expires_on <= limit) expiring.push({ kind, expires_on: best.expires_on });
  }
  const verdict: Verdict = lapsed.length ? 'lapsed' : missing.length ? 'missing' : expiring.length ? 'expiring' : 'compliant';
  return { verdict, missing, lapsed, expiring };
}

/** Company names as typed at the gate vs the register: same normalisation as people. */
export function normaliseCompany(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b(pty|ltd|p\/l|limited|proprietary)\b\.?/g, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}
