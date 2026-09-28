#!/usr/bin/env node
/**
 * The off-site copy (README R113, docs/backups.md).
 *
 *   node scripts/backup-offsite.mjs                         # every bucket, then the manifest
 *   node scripts/backup-offsite.mjs --dry-run               # list and decide, copy nothing
 *   node scripts/backup-offsite.mjs --buckets entry-audio   # only these buckets (comma-separated)
 *   node scripts/backup-offsite.mjs --file data.sql.gz data.sql.gz   # also put a local file under db/<date>/
 *
 * Every object in every Storage bucket is copied to an S3-compatible bucket the
 * company holds, under storage/<bucket>/<path>. An object already there at the
 * same size is left alone; nothing there is ever deleted or overwritten with
 * less — the copy is append-only, so a mistake in the app cannot reach it. The
 * night's database dump (made by the workflow with `supabase db dump`) goes
 * under db/<date>/, and a manifest of the whole night under manifests/<date>.json.
 *
 * Reads Storage with the service role; writes nowhere in Supabase. Exits 1 on
 * any failure so the scheduled run is red and someone is told.
 *
 * Environment (names only are ever printed):
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
 *   BACKUP_S3_REGION (default auto — right for Cloudflare R2), BACKUP_S3_PATH_STYLE (1 for a local S3)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { copyKey, decide, describe, dumpKey, manifestKey, perthDate, summarise } from '../src/lib/backup/offsite.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = (() => { const i = args.indexOf('--buckets'); return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim()).filter(Boolean)) : null; })();
const files = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--file') { files.push({ local: args[i + 1], name: args[i + 2] }); i += 2; }

const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 200);
const need = (name, alt) => {
  const v = process.env[name] ?? (alt ? process.env[alt] : undefined);
  if (!v) { console.error(`${name} is not set — see docs/backups.md`); process.exit(2); }
  return v;
};

const supabase = createClient(need('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const s3Configured = Boolean(process.env.BACKUP_S3_BUCKET);
if (!dryRun && !s3Configured) need('BACKUP_S3_BUCKET');
const s3 = s3Configured
  ? new S3Client({
      endpoint: need('BACKUP_S3_ENDPOINT'),
      region: process.env.BACKUP_S3_REGION || 'auto',
      forcePathStyle: process.env.BACKUP_S3_PATH_STYLE === '1',
      credentials: { accessKeyId: need('BACKUP_S3_ACCESS_KEY_ID'), secretAccessKey: need('BACKUP_S3_SECRET_ACCESS_KEY') },
    })
  : null;
const Bucket = process.env.BACKUP_S3_BUCKET;

/** Every object in a bucket, folders walked, pages of 1000. */
async function walk(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${firstLine(error)}`);
    for (const item of data ?? []) {
      const p = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null) out.push(...(await walk(bucket, p)));
      else out.push({ bucket, path: p, size: item.metadata?.size ?? null, contentType: item.metadata?.mimetype ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function existingSize(key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
    throw e;
  }
}

async function copyOne(obj) {
  const key = copyKey(obj.bucket, obj.path);
  const bytes = obj.size ?? 0;
  try {
    const d = decide(obj, s3 ? await existingSize(key) : null);
    if (!d.copy) return { key, bucket: obj.bucket, bytes, outcome: 'skipped' };
    if (dryRun) return { key, bucket: obj.bucket, bytes, outcome: 'copied', dry: true };
    const { data, error } = await supabase.storage.from(obj.bucket).download(obj.path);
    if (error) throw new Error(`download: ${firstLine(error)}`);
    const body = Buffer.from(await data.arrayBuffer());
    await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: obj.contentType ?? 'application/octet-stream' }));
    return { key, bucket: obj.bucket, bytes: body.length, outcome: 'copied' };
  } catch (e) {
    return { key, bucket: obj.bucket, bytes, outcome: 'failed', error: firstLine(e) };
  }
}

/** A few at a time: enough to move a night's worth, not enough to trip Storage's limits. */
async function pool(items, worker, width = 4) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await worker(items[i]);
  }));
  return results;
}

const started = new Date();
const { data: bucketRows, error: bucketsError } = await supabase.storage.listBuckets();
if (bucketsError) { console.error(`listBuckets: ${firstLine(bucketsError)}`); process.exit(1); }
const buckets = (bucketRows ?? []).map((b) => b.name).filter((n) => !only || only.has(n)).sort();
if (buckets.length === 0) { console.error('No buckets to copy.'); process.exit(1); }

const objects = [];
for (const b of buckets) {
  const found = await walk(b);
  objects.push(...found);
  console.log(`${b}: ${found.length} objects, ${(found.reduce((t, o) => t + (o.size ?? 0), 0) / 1048576).toFixed(1)} MB`);
}

const results = await pool(objects, copyOne);

const dumps = [];
for (const f of files) {
  const key = dumpKey(perthDate(started), f.name);
  try {
    const body = fs.readFileSync(path.resolve(f.local));
    if (!dryRun) await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'application/gzip' }));
    dumps.push({ key, bytes: body.length });
  } catch (e) {
    results.push({ key, bucket: 'db', bytes: 0, outcome: 'failed', error: firstLine(e) });
  }
}

const manifest = summarise(results, dumps, started);
if (!dryRun) {
  try {
    await s3.send(new PutObjectCommand({ Bucket, Key: manifestKey(manifest.date), Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json' }));
  } catch (e) {
    manifest.failures.push({ key: manifestKey(manifest.date), error: firstLine(e) });
    manifest.totals.failed += 1;
  }
}
console.log((dryRun ? 'DRY RUN · ' : '') + describe(manifest));
for (const f of manifest.failures) console.log(`  failed: ${f.key} — ${f.error}`);
process.exit(manifest.totals.failed > 0 ? 1 : 0);
