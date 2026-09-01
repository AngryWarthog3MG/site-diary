import { createClient } from '@supabase/supabase-js';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verify a docket · KBS Daily Diary' };

/**
 * The public verification door. Anyone holding a docket PDF can check the
 * serial and hash printed in its signature block against the record — no
 * account, no sign-in. The answer is authenticity facts only: whether the
 * entry exists, whether the hash matches, whether the stored record still
 * recomputes to the same hash today, and whether a correction supersedes it.
 * Nothing of the record's content is ever returned.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string; hash?: string }>;
}) {
  const params = await searchParams;
  const entryNo = (params.entry ?? '').trim();
  const hash = (params.hash ?? '').trim();

  interface VerifyResult {
    found: boolean;
    hash_matches?: boolean;
    record_intact?: boolean;
    signed_at?: string;
    entry_date?: string;
    superseded_by?: string | null;
  }
  let result: VerifyResult | null = null;

  if (entryNo && hash) {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false } },
    );
    const { data } = await anon.rpc('verify_entry', { p_entry_no: entryNo, p_hash: hash });
    result = (data as VerifyResult | null) ?? null;
  }

  const verified = result?.found && result.hash_matches && result.record_intact;

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet auth-card">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand__frog" src="/brand/frog.png" alt="" width={34} height={38} />
          <span className="brand__name">Verify a docket</span>
        </div>
        <p className="page-subtitle">
          Every signed KBS Daily Diary docket prints its serial and SHA-256 content hash in
          the signature block. Enter both, exactly as printed, to check the document against
          the record.
        </p>
        <hr className="rule" />
        <form method="get">
          <label className="fieldcell">
            <span className="label">Entry serial</span>
            <input className="field mono" name="entry" defaultValue={entryNo} placeholder="KBL-2026-09-01" />
          </label>
          <label className="fieldcell">
            <span className="label">Content hash (SHA-256)</span>
            <input className="field mono" name="hash" defaultValue={hash} placeholder="8d3aa3e1dc1d…" />
          </label>
          <button className="button" type="submit">Verify</button>
        </form>

        {result && !result.found && (
          <p className="verify-result verify-result--bad">
            No signed entry with that serial is on the record.
          </p>
        )}
        {result?.found && (
          <div className={`verify-result ${verified ? 'verify-result--ok' : 'verify-result--bad'}`}>
            <p className="verify-result__headline">
              {verified
                ? 'Verified — this document matches the signed record.'
                : 'DOES NOT VERIFY — the hash does not match the signed record.'}
            </p>
            <ul>
              <li>Entry exists and is signed: yes ({result.entry_date})</li>
              <li>Printed hash matches the record: {result.hash_matches ? 'yes' : 'NO'}</li>
              <li>
                Record recomputes to the same hash today: {result.record_intact ? 'yes' : 'NO'}
              </li>
              {result.superseded_by && (
                <li>
                  Note: this entry has been superseded by a signed correction (
                  {result.superseded_by}). Both remain on the record.
                </li>
              )}
            </ul>
          </div>
        )}
        <p className="brand__org">Kooboolong Services Pty Ltd</p>
      </section>
      <div className="brand__wave" aria-hidden />
    </main>
  );
}
