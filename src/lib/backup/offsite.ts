/**
 * The off-site copy (README R113): every file in every Storage bucket, and the
 * night's database dump, kept somewhere that is not Supabase.
 *
 * Supabase's own backups never include Storage — a photograph deleted after a
 * backup is gone from the restore too — and a free project has no backups at
 * all. So a scheduled job (`.github/workflows/backup.yml`, `scripts/backup-offsite.mjs`)
 * copies each object to an S3-compatible bucket the company holds, and never
 * deletes anything there: the copy is append-only, so a mistake in the app
 * cannot propagate to it. This module is the pure part — keys, the decision to
 * copy, the manifest — so it can be tested without a bucket at either end.
 *
 * Relative imports only: `scripts/backup-offsite.mjs` loads this under plain
 * Node, which has no `@/` alias.
 */

export interface SourceObject {
  bucket: string;
  path: string;
  /** Bytes as Storage reports them; null when it reports nothing. */
  size: number | null;
  contentType: string | null;
}

export interface CopyDecision {
  key: string;
  /** Why it is (or is not) copied tonight. */
  reason: 'missing' | 'size_differs' | 'up_to_date' | 'size_unknown';
  copy: boolean;
}

/** Where an object sits in the off-site bucket. One prefix per source bucket, the path kept whole. */
export function copyKey(bucket: string, path: string): string {
  return `storage/${bucket}/${path}`;
}

/** Where a night's database dump sits. */
export function dumpKey(date: string, fileName: string): string {
  return `db/${date}/${fileName}`;
}

export function manifestKey(date: string): string {
  return `manifests/${date}.json`;
}

/**
 * Copy when the object is not there, or is there at a different size. An
 * object whose size Storage does not report is copied when absent and left
 * alone when present — the copy cannot be judged, and rewriting it nightly
 * would cost every night what it saves never.
 */
export function decide(source: SourceObject, existingSize: number | null | undefined): CopyDecision {
  const key = copyKey(source.bucket, source.path);
  if (existingSize == null) return { key, reason: 'missing', copy: true };
  if (source.size == null) return { key, reason: 'size_unknown', copy: false };
  if (source.size !== existingSize) return { key, reason: 'size_differs', copy: true };
  return { key, reason: 'up_to_date', copy: false };
}

export interface CopyResult {
  key: string;
  bucket: string;
  bytes: number;
  outcome: 'copied' | 'skipped' | 'failed';
  error?: string;
}

export interface BucketSummary {
  bucket: string;
  objects: number;
  bytes: number;
  copied: number;
  copiedBytes: number;
  failed: number;
}

export interface Manifest {
  taken_at: string;
  date: string;
  buckets: BucketSummary[];
  dumps: Array<{ key: string; bytes: number }>;
  totals: { objects: number; bytes: number; copied: number; copiedBytes: number; failed: number };
  failures: Array<{ key: string; error: string }>;
}

/** The night's manifest: what was found, what moved, what did not. */
export function summarise(
  results: CopyResult[],
  dumps: Array<{ key: string; bytes: number }>,
  now: Date,
): Manifest {
  const byBucket = new Map<string, BucketSummary>();
  for (const r of results) {
    const s = byBucket.get(r.bucket) ?? { bucket: r.bucket, objects: 0, bytes: 0, copied: 0, copiedBytes: 0, failed: 0 };
    s.objects += 1;
    s.bytes += r.bytes;
    if (r.outcome === 'copied') { s.copied += 1; s.copiedBytes += r.bytes; }
    if (r.outcome === 'failed') s.failed += 1;
    byBucket.set(r.bucket, s);
  }
  const buckets = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const totals = buckets.reduce(
    (t, b) => ({ objects: t.objects + b.objects, bytes: t.bytes + b.bytes, copied: t.copied + b.copied, copiedBytes: t.copiedBytes + b.copiedBytes, failed: t.failed + b.failed }),
    { objects: 0, bytes: 0, copied: 0, copiedBytes: 0, failed: 0 },
  );
  return {
    taken_at: now.toISOString(),
    date: perthDate(now),
    buckets,
    dumps,
    totals,
    failures: results.filter((r) => r.outcome === 'failed').map((r) => ({ key: r.key, error: r.error ?? 'failed' })),
  };
}

/** The Perth calendar day of an instant, YYYY-MM-DD. AWST is UTC+8 with no daylight saving. */
export function perthDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** One line a person reads in the job's log. */
export function describe(m: Manifest): string {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const head = `${m.date}: ${m.totals.objects} objects, ${mb(m.totals.bytes)} MB across ${m.buckets.length} buckets · copied ${m.totals.copied} (${mb(m.totals.copiedBytes)} MB) · dumps ${m.dumps.length}`;
  return m.totals.failed > 0 ? `${head} · FAILED ${m.totals.failed}` : `${head} · no failures`;
}
