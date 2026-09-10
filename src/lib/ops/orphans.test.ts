import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrphan, isRecent } from './orphans.ts';

const P = 'b44c4faf-0000-0000-0000-000000000001';
const DRAFT = 'e1000000-0000-0000-0000-000000000001';
const SIGNED = 'e2000000-0000-0000-0000-000000000002';
const entries = new Map([
  [DRAFT, { id: DRAFT, status: 'draft', project_id: P, entry_date: '2026-09-09' }],
  [SIGNED, { id: SIGNED, status: 'signed', project_id: P, entry_date: '2026-09-03' }],
]);
const f = (path: string, createdAt: string | null = '2026-09-09T22:48:00Z') => ({ path, createdAt });

test('a photo under an unsigned draft is put back on the day', () => {
  assert.deepEqual(classifyOrphan(f(`${P}/${DRAFT}/abc.jpg`), new Set(), entries),
    { kind: 'attach', path: `${P}/${DRAFT}/abc.jpg`, entryId: DRAFT, takenAt: '2026-09-09T22:48:00Z' });
});

test('a referenced file is left alone', () => {
  const path = `${P}/${DRAFT}/abc.jpg`;
  assert.equal(classifyOrphan(f(path), new Set([path]), entries).kind, 'ignore');
});

test('a photo under a signed day and a nameless signature are reported, never written', () => {
  assert.equal(classifyOrphan(f(`${P}/${SIGNED}/abc.jpg`), new Set(), entries).kind, 'unrecoverable');
  const sig = classifyOrphan(f(`${P}/${DRAFT}/signature-supervisor-x.png`), new Set(), entries);
  assert.equal(sig.kind, 'unrecoverable');
  assert.match((sig as { reason: string }).reason, /signature/);
});

test('prestart and plant folders, and non-photos, are ignored here', () => {
  assert.equal(classifyOrphan(f(`${P}/prestart/x/sig.png`), new Set(), entries).kind, 'ignore');
  assert.equal(classifyOrphan(f(`${P}/plant/x/sig.png`), new Set(), entries).kind, 'ignore');
  assert.equal(classifyOrphan(f(`${P}/${DRAFT}/notes.txt`), new Set(), entries).kind, 'ignore');
});

test('recent means the last 48 hours', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  assert.equal(isRecent(f('x', '2026-09-09T22:48:00Z'), now), true);
  assert.equal(isRecent(f('x', '2026-09-02T10:52:00Z'), now), false);
  assert.equal(isRecent(f('x', null), now), false);
});

test('a photo whose folder is another project is never attached', () => {
  const action = classifyOrphan(f(`other-project/${DRAFT}/abc.jpg`), new Set(), entries);
  assert.equal(action.kind, 'unrecoverable');
});
