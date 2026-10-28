import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, dosDateTime, listZip, zipBytes, zipStream, type ZipEntry } from './zip.ts';

const noon = { year: 2026, month: 10, day: 22, hour: 12, minute: 0, second: 0 };
const enc = new TextEncoder();

test('crc32 matches the published check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('DOS date and time pack the fields, years before 1980 clamp', () => {
  const { date, time } = dosDateTime(noon);
  assert.equal(date, ((2026 - 1980) << 9) | (10 << 5) | 22);
  assert.equal(time, 12 << 11);
  assert.equal(dosDateTime({ ...noon, year: 1970 }).date >> 9, 0);
});

test('the archive lists what was written, in order, with sizes and checks', async () => {
  const entries: ZipEntry[] = [
    { name: 'C010 photographs/2026-10-22/2026-10-22 01 Site photograph.jpg', bytes: enc.encode('not really a jpeg'), mtime: noon },
    { name: 'C010 photographs/2026-10-23/2026-10-23 01 Dayworks – café.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mtime: noon },
  ];
  const bytes = await zipBytes(entries);
  const listed = listZip(bytes);
  assert.deepEqual(listed.map((e) => [e.name, e.size]), entries.map((e) => [e.name, e.bytes.length]));
  assert.equal(listed[0].crc, crc32(entries[0].bytes));
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

test('the same files give the same bytes', async () => {
  const entries: ZipEntry[] = [{ name: 'a/b.jpg', bytes: enc.encode('abc'), mtime: noon }];
  assert.deepEqual(await zipBytes(entries), await zipBytes(entries));
});

test('entries may arrive from an async source', async () => {
  async function* source() {
    yield { name: 'one.txt', bytes: enc.encode('1'), mtime: noon };
    yield { name: 'two.txt', bytes: enc.encode('22'), mtime: noon };
  }
  const chunks: Uint8Array[] = [];
  const reader = zipStream(source()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  assert.deepEqual(listZip(all).map((e) => e.name), ['one.txt', 'two.txt']);
});

test('the system unzip accepts the archive and reads the names back', async () => {
  if (!existsSync('/usr/bin/unzip')) return;
  const bytes = await zipBytes([
    { name: 'C010 photographs/2026-10-22/2026-10-22 01 Site photograph – ok.jpg', bytes: enc.encode('hello'), mtime: noon },
    { name: 'C010 photographs/2026-10-22/2026-10-22 02 Dayworks.jpg', bytes: enc.encode('world'), mtime: noon },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 't.zip');
  writeFileSync(file, bytes);
  const out = execFileSync('/usr/bin/unzip', ['-t', file], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
  // The names, read by a second, independent reader: the archive says its names are UTF-8 (flag bit 11), and
  // Python's zipfile honours that; macOS's unzip prints them in the terminal's charset, so it only tests the structure.
  if (!existsSync('/usr/bin/python3')) return;
  const names = execFileSync('/usr/bin/python3', ['-I', '-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(names, ['C010 photographs/2026-10-22/2026-10-22 01 Site photograph – ok.jpg', 'C010 photographs/2026-10-22/2026-10-22 02 Dayworks.jpg']);
});
