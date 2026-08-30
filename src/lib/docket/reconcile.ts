/**
 * Docket reconciliation (brief §4): what the docket says versus what was
 * spoken. Where they differ, the docket wins — supervisors estimate, dockets
 * don't — and the difference is shown rather than silently applied.
 *
 * Pure and dependency-free: it runs in the review screen (to apply and show
 * the changes) and in the tests. It never touches a signed entry — the review
 * screen only exists for drafts.
 */

export interface DocketRead {
  docket_no: string | null;
  volume_m3: number | null;
  mix_spec: string | null;
  supplier: string | null;
  /** False when the photo could not be read as a docket at all. */
  legible: boolean;
  /** Why a field is missing or the read failed — shown to the supervisor. */
  issue: string | null;
}

export interface PourLike {
  volume_m3?: number | null;
  mix_spec?: string | null;
  supplier?: string | null;
  docket_nos?: string[] | null;
}

export interface DocketChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

const same = (a: string | null | undefined, b: string): boolean =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

const show = (value: unknown): string =>
  value == null || value === '' ? 'not stated' : String(value);

/**
 * Apply one docket read to one pour.
 *
 * The docket only overrules the spoken volume, mix and supplier when it is the
 * pour's FIRST docket. A pour of several trucks has several dockets, and one
 * truck's load quantity is not the pour's total — overwriting the spoken total
 * with one load would put a wrong number on the record in the docket's name.
 * The docket number itself is always added.
 */
export function reconcilePour(
  pour: PourLike,
  read: DocketRead,
): { patch: Record<string, unknown>; changes: DocketChange[] } {
  const patch: Record<string, unknown> = {};
  const changes: DocketChange[] = [];
  const existing = (pour.docket_nos ?? []).filter(Boolean);

  if (read.docket_no) {
    const already = existing.some((no) => same(no, read.docket_no as string));
    if (!already) {
      patch.docket_nos = [...existing, read.docket_no.trim()];
      changes.push({
        field: 'docket_nos',
        label: 'Docket no.',
        from: existing.length ? existing.join(', ') : 'none',
        to: [...existing, read.docket_no.trim()].join(', '),
      });
    }
  }

  const firstDocket = existing.length === 0;
  if (firstDocket) {
    if (read.volume_m3 != null && read.volume_m3 !== (pour.volume_m3 ?? null)) {
      patch.volume_m3 = read.volume_m3;
      changes.push({
        field: 'volume_m3',
        label: 'Volume m³',
        from: show(pour.volume_m3),
        to: String(read.volume_m3),
      });
    }
    if (read.mix_spec && !same(pour.mix_spec, read.mix_spec)) {
      patch.mix_spec = read.mix_spec.trim();
      changes.push({
        field: 'mix_spec',
        label: 'Mix',
        from: show(pour.mix_spec),
        to: read.mix_spec.trim(),
      });
    }
    if (read.supplier && !same(pour.supplier, read.supplier)) {
      patch.supplier = read.supplier.trim();
      changes.push({
        field: 'supplier',
        label: 'Supplier',
        from: show(pour.supplier),
        to: read.supplier.trim(),
      });
    }
  }

  return { patch, changes };
}
