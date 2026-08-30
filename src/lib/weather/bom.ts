import 'server-only';

import { Writable } from 'node:stream';
import { Client } from 'basic-ftp';
import { parseObservations } from './parse';
import type { BomSnapshot } from './types';

/**
 * Pulls a state observation product from the Bureau of Meteorology.
 *
 * Over anonymous FTP, because that is the channel the Bureau names as
 * supported for automated access. Their HTTP JSON feeds answer a scripted
 * request with a 403 telling you to stop, and api.weather.bom.gov.au is served
 * with an explicit "you must not use, copy or share it" notice — neither is a
 * foundation for a record that has to stand up in a dispute.
 *
 * One product covers an entire state, so this is called once per state every
 * few minutes and cached, never once per supervisor.
 */

const FTP_HOST = 'ftp.bom.gov.au';
const FTP_DIR = '/anon/gen/fwo';
const TIMEOUT_MS = 20_000;

/** Products run to a few hundred KB; anything near this is a wrong turn. */
const MAX_BYTES = 8 * 1024 * 1024;

export class BomFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BomFetchError';
  }
}

function collector(chunks: Buffer[]): Writable {
  let total = 0;
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        callback(new BomFetchError('BOM product is implausibly large; aborting.'));
        return;
      }
      chunks.push(chunk);
      callback();
    },
  });
}

export async function fetchProduct(productId: string): Promise<BomSnapshot> {
  if (!/^ID[DNQSTVW]60920$/.test(productId)) {
    throw new BomFetchError(`Unknown BOM product ${productId}.`);
  }

  const client = new Client(TIMEOUT_MS);
  const chunks: Buffer[] = [];

  try {
    await client.access({
      host: FTP_HOST,
      user: 'anonymous',
      // Anonymous FTP convention: identify yourself in the password.
      password: process.env.BOM_CONTACT_EMAIL || 'site-diary@example.com',
      secure: false,
    });
    await client.downloadTo(collector(chunks), `${FTP_DIR}/${productId}.xml`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BomFetchError(`Could not reach the Bureau of Meteorology: ${message}`);
  } finally {
    client.close();
  }

  const xml = Buffer.concat(chunks).toString('utf8');
  if (!xml.includes('<observations>')) {
    throw new BomFetchError(`${productId} did not contain observations.`);
  }

  return parseObservations(xml, productId);
}

/**
 * Required wherever these numbers are shown or exported. The product itself
 * points at http://www.bom.gov.au/other/copyright.shtml.
 */
export const BOM_ATTRIBUTION = 'Observations © Commonwealth of Australia, Bureau of Meteorology';
