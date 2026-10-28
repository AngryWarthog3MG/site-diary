/**
 * A zip file, written as a stream, with nothing compressed (README R173).
 *
 * The photo library's download is a folder of JPEGs, and a JPEG does not shrink under deflate; the
 * STORE method writes the bytes as they are, which keeps this file small enough to read and leaves
 * no library to depend on. Each file goes out the moment its bytes are in hand — local header, bytes —
 * and the central directory follows at the end, so a job of several hundred photographs streams
 * through a 1 GB function without being held whole. No Zip64: under 4 GB and 65,535 files, which a
 * month of a job's photographs is well inside; the writer refuses beyond that rather than writing a
 * file an unzipper would mangle.
 *
 * Dependency-free; Node-tested with its own reader of the directory it wrote.
 */

export interface ZipEntry {
  /** Path inside the archive, `/` separated. */
  name: string;
  bytes: Uint8Array;
  /** The file's modified time; the archive carries it to DOS precision (two seconds), local time as given. */
  mtime: { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields, as the zip format keeps them. Years before 1980 clamp to 1980. */
export function dosDateTime(t: ZipEntry['mtime']): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, t.year));
  const date = ((year - 1980) << 9) | (Math.max(1, Math.min(12, t.month)) << 5) | Math.max(1, Math.min(31, t.day));
  const time = (Math.max(0, Math.min(23, t.hour)) << 11) | (Math.max(0, Math.min(59, t.minute)) << 5) | (Math.max(0, Math.min(59, t.second)) >> 1);
  return { date, time };
}

const MAX_ENTRIES = 65_535;
const MAX_BYTES = 0xffff_ffff;

function u16(view: DataView, at: number, v: number) { view.setUint16(at, v, true); }
function u32(view: DataView, at: number, v: number) { view.setUint32(at, v >>> 0, true); }

/**
 * Writes `entries` into a zip, one after another as they arrive, and ends with the central directory.
 * The entries may come from an async source (a download each), which is the point: the response starts
 * before the last photograph is fetched.
 */
export function zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  const iterator = (async function* () {
    for await (const entry of entries as AsyncIterable<ZipEntry>) yield entry;
  })();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        const dirStart = offset;
        let dirSize = 0;
        for (const c of central) {
          controller.enqueue(c);
          dirSize += c.length;
        }
        const end = new Uint8Array(22);
        const v = new DataView(end.buffer);
        u32(v, 0, 0x06054b50);
        u16(v, 4, 0);
        u16(v, 6, 0);
        u16(v, 8, count);
        u16(v, 10, count);
        u32(v, 12, dirSize);
        u32(v, 16, dirStart);
        u16(v, 20, 0);
        controller.enqueue(end);
        controller.close();
        return;
      }
      const entry = next.value;
      if (count >= MAX_ENTRIES) throw new Error('Too many files for one zip.');
      if (offset + entry.bytes.length + 30 + 46 > MAX_BYTES) throw new Error('Too large for one zip.');
      const name = encoder.encode(entry.name);
      const crc = crc32(entry.bytes);
      const { date, time } = dosDateTime(entry.mtime);
      const size = entry.bytes.length;

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20); // version needed: 2.0
      u16(lv, 6, 0x0800); // flags: names are UTF-8
      u16(lv, 8, 0); // STORE
      u16(lv, 10, time);
      u16(lv, 12, date);
      u32(lv, 14, crc);
      u32(lv, 18, size);
      u32(lv, 22, size);
      u16(lv, 26, name.length);
      u16(lv, 28, 0);
      local.set(name, 30);

      const dir = new Uint8Array(46 + name.length);
      const dv = new DataView(dir.buffer);
      u32(dv, 0, 0x02014b50);
      u16(dv, 4, 20); // made by: 2.0, MS-DOS attributes
      u16(dv, 6, 20);
      u16(dv, 8, 0x0800);
      u16(dv, 10, 0);
      u16(dv, 12, time);
      u16(dv, 14, date);
      u32(dv, 16, crc);
      u32(dv, 20, size);
      u32(dv, 24, size);
      u16(dv, 28, name.length);
      u16(dv, 30, 0);
      u16(dv, 32, 0);
      u16(dv, 34, 0);
      u16(dv, 36, 0);
      u32(dv, 38, 0);
      u32(dv, 42, offset);
      dir.set(name, 46);
      central.push(dir);

      controller.enqueue(local);
      controller.enqueue(entry.bytes);
      offset += local.length + size;
      count += 1;
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** The whole archive in memory — for tests and small sets. */
export async function zipBytes(entries: Iterable<ZipEntry>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = zipStream(entries).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Reads the central directory of an archive this writer made: names and sizes, in order. For tests. */
export function listZip(bytes: Uint8Array): Array<{ name: string; size: number; crc: number }> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  if (v.getUint32(endAt, true) !== 0x06054b50) throw new Error('Not a zip this writer made.');
  const count = v.getUint16(endAt + 10, true);
  let at = v.getUint32(endAt + 16, true);
  const out: Array<{ name: string; size: number; crc: number }> = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('Central directory is broken.');
    const nameLen = v.getUint16(at + 28, true);
    out.push({ crc: v.getUint32(at + 16, true), size: v.getUint32(at + 24, true), name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen)) });
    at += 46 + nameLen;
  }
  return out;
}
