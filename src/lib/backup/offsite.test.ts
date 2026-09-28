import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyKey, decide, describe, dumpKey, manifestKey, perthDate, summarise } from './offsite.ts';

test('keys keep the bucket and the whole path', () => {
  assert.equal(copyKey('entry-photos', 'p1/e1/a.jpg'), 'storage/entry-photos/p1/e1/a.jpg');
  assert.equal(dumpKey('2026-09-29', 'data.sql.gz'), 'db/2026-09-29/data.sql.gz');
  assert.equal(manifestKey('2026-09-29'), 'manifests/2026-09-29.json');
});

test('copy when missing or a different size; never rewrite what is already there at the same size', () => {
  const src = { bucket: 'exports', path: 'x/KBL-2026-09-14.pdf', size: 100, contentType: 'application/pdf' };
  assert.deepEqual(decide(src, null), { key: 'storage/exports/x/KBL-2026-09-14.pdf', reason: 'missing', copy: true });
  assert.equal(decide(src, 100).copy, false);
  assert.equal(decide(src, 99).reason, 'size_differs');
  assert.equal(decide(src, 99).copy, true);
});

test('an object Storage reports no size for is copied when absent and left alone when present', () => {
  const src = { bucket: 'swms-docs', path: 'a/b.pdf', size: null, contentType: null };
  assert.equal(decide(src, undefined).copy, true);
  assert.deepEqual(decide(src, 5), { key: 'storage/swms-docs/a/b.pdf', reason: 'size_unknown', copy: false });
});

test('the manifest counts per bucket and in total, and names every failure', () => {
  const now = new Date('2026-09-28T19:30:00Z'); // 03:30 on 29/09 in Perth
  const m = summarise(
    [
      { key: 'storage/entry-photos/a.jpg', bucket: 'entry-photos', bytes: 1000, outcome: 'copied' },
      { key: 'storage/entry-photos/b.jpg', bucket: 'entry-photos', bytes: 2000, outcome: 'skipped' },
      { key: 'storage/exports/c.pdf', bucket: 'exports', bytes: 5000, outcome: 'failed', error: 'timeout' },
    ],
    [{ key: 'db/2026-09-29/data.sql.gz', bytes: 300 }],
    now,
  );
  assert.equal(m.date, '2026-09-29');
  assert.deepEqual(m.buckets.map((b) => b.bucket), ['entry-photos', 'exports']);
  assert.deepEqual(m.buckets[0], { bucket: 'entry-photos', objects: 2, bytes: 3000, copied: 1, copiedBytes: 1000, failed: 0 });
  assert.deepEqual(m.totals, { objects: 3, bytes: 8000, copied: 1, copiedBytes: 1000, failed: 1 });
  assert.deepEqual(m.failures, [{ key: 'storage/exports/c.pdf', error: 'timeout' }]);
  assert.match(describe(m), /FAILED 1/);
});

test('perthDate is the Perth day, not the UTC one', () => {
  assert.equal(perthDate(new Date('2026-09-28T17:00:00Z')), '2026-09-29');
  assert.equal(perthDate(new Date('2026-09-28T15:59:00Z')), '2026-09-28');
});

test('a clean night reads as one', () => {
  const m = summarise([{ key: 'storage/x/y', bucket: 'x', bytes: 10, outcome: 'skipped' }], [], new Date('2026-09-28T19:30:00Z'));
  assert.match(describe(m), /no failures$/);
});
