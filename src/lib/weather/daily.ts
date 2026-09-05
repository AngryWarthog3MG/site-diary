import 'server-only';

import { Writable } from 'node:stream';
import { Client } from 'basic-ftp';
import { BomFetchError } from './bom';
import { parseDailyClimate, type DailyClimateRow } from './daily-parse';

/**
 * Pulls a station's daily climate table (product IDCKWCDEA0) from the Bureau's
 * anonymous FTP — the same channel, and the same reasoning, as `bom.ts`.
 *
 * One file per station per month, a few KB each, re-issued once a day around
 * 06:30 GMT with yesterday's row added. Called from the day store when the
 * week's readings are refreshed, never per screen.
 */

const FTP_HOST = 'ftp.bom.gov.au';
const FTP_DIR = '/anon/gen/clim_data/IDCKWCDEA0/tables';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 512 * 1024;

/**
 * Every month's table for one station, in one FTP session. A month the Bureau
 * has no file for (a station without a daily table, or a month before it
 * existed) is simply absent from the result — the caller then has only
 * observations for those days, which is the honest state of affairs.
 */
export async function fetchDailyClimate(
  state: string,
  slug: string,
  months: readonly string[],
): Promise<Map<string, DailyClimateRow[]>> {
  if (!/^[a-z]{2,3}$/.test(state) || !/^[a-z0-9_]+$/.test(slug)) {
    throw new BomFetchError(`Refusing a malformed daily-table path (${state}/${slug}).`);
  }
  const out = new Map<string, DailyClimateRow[]>();
  if (months.length === 0) return out;

  const client = new Client(TIMEOUT_MS);
  try {
    await client.access({
      host: FTP_HOST,
      user: 'anonymous',
      password: process.env.BOM_CONTACT_EMAIL || 'site-diary@example.com',
      secure: false,
    });
    for (const month of months) {
      if (!/^\d{6}$/.test(month)) continue;
      const chunks: Buffer[] = [];
      let total = 0;
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (total > MAX_BYTES) {
            cb(new BomFetchError('Daily table is implausibly large; aborting.'));
            return;
          }
          chunks.push(chunk);
          cb();
        },
      });
      try {
        await client.downloadTo(sink, `${FTP_DIR}/${state}/${slug}/${slug}-${month}.csv`);
      } catch (error) {
        // 550: no such file. Not an error — the Bureau has no table for it.
        if (/550/.test(error instanceof Error ? error.message : String(error))) continue;
        throw error;
      }
      out.set(month, parseDailyClimate(Buffer.concat(chunks).toString('latin1')));
    }
  } catch (error) {
    if (error instanceof BomFetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BomFetchError(`Could not reach the Bureau of Meteorology: ${message}`);
  } finally {
    client.close();
  }
  return out;
}
