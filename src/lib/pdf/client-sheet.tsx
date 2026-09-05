import { LOGO_DATA_URI } from './logo';
import type { DocketEntry, Row } from './load';
import type { PhotoImage } from './docket';
import type { SignatureImage } from './photos';
import { formatInstant, num, text } from './load';
import { fmtDate } from './dates';

/**
 * The dayworks and variations sheet: the part of a signed day the client
 * pays for, on its own page, with a place for their representative to sign.
 *
 * Drawn from the same stored fields as the daily docket — nothing here can
 * disagree with the diary, because it is the diary, with the rest left off.
 * Same rules: no generated text, deterministic render, the stored copy is
 * the document.
 */

const DAYWORK_PHOTO = /^Daywork/;
const VARIATION_PHOTO = /^Variation/;

function shortInstant(value: string | null): string {
  const full = formatInstant(value);
  return full === '—' ? full : full.replace(/:\d\d( AWST| UTC)?$/, '$1');
}

export function ClientSheet({
  entry,
  photos,
  signatures = [],
}: {
  entry: DocketEntry;
  photos: PhotoImage[];
  signatures?: SignatureImage[];
}) {
  const dayworks = entry.dayworks ?? [];
  const variations = entry.variations ?? [];
  const relevant = photos.filter((p) => DAYWORK_PHOTO.test(p.context) || VARIATION_PHOTO.test(p.context));
  const supervisor = signatures.find((s) => s.role === 'supervisor') ?? null;
  const client = signatures.find((s) => s.role === 'client') ?? null;
  const totalHours = dayworks.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  const totalCost = variations.reduce((sum, r) => sum + (Number(r.estimated_cost) || 0), 0);

  return (
    <article className="docket csheet">
      <header className="head">
        <div className="head__left">
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {entry.org_name}
          </p>
          <h1>Dayworks &amp; variations</h1>
          <p className="mono sub">
            {entry.project_name} · {entry.org_code}_{entry.project_code}
            {entry.principal_contractor ? ` · for ${entry.principal_contractor}` : ''}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">From site diary</p>
          <p className="mono serial">{entry.entry_no ?? 'DRAFT'}</p>
          <p className="mono sub">{fmtDate(entry.entry_date)}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">Dayworks · {dayworks.length}</p>
        {dayworks.length === 0 ? (
          <p className="nil">NIL — no dayworks on this day</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w">Description</th>
                <th className="k">Docket / ref</th>
                <th className="n">Hours</th>
                <th>Labour</th>
                <th>Plant</th>
                <th>Materials</th>
              </tr>
            </thead>
            <tbody>
              {dayworks.map((r: Row, i) => (
                <tr key={i}>
                  <td className="w">{text(r.description)}</td>
                  <td className="k">{text(r.docket_ref)}</td>
                  <td className="n mono">{num(r.hours)}</td>
                  <td>{text(r.labour)}</td>
                  <td>{text(r.plant)}</td>
                  <td>{text(r.materials)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total hours</td>
                <td className="n mono">{num(totalHours)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Variations · {variations.length}</p>
        {variations.length === 0 ? (
          <p className="nil">NIL — no variations on this day</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="k">VR ref</th>
                <th className="w">Description</th>
                <th>Directed by</th>
                <th className="k">Directed at</th>
                <th className="n">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {variations.map((r: Row, i) => (
                <tr key={i}>
                  <td className="k">{text(r.vr_ref)}</td>
                  <td className="w">{text(r.description)}</td>
                  <td>{text(r.directed_by)}</td>
                  <td className="k">{shortInstant((r.directed_at as string | null) ?? null)}</td>
                  <td className="n mono">{num(r.estimated_cost)}</td>
                </tr>
              ))}
            </tbody>
            {totalCost > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total estimated</td>
                  <td className="n mono">{num(totalCost)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
      </section>

      {relevant.length > 0 && (
        <section className="sect photos">
          <p className="lbl">Photographs</p>
          <div className="photos__grid">
            {relevant.map((photo, index) => (
              <figure key={index}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} alt={photo.caption ?? photo.context} />
                <figcaption className="mono">
                  {index + 1}. {photo.context}
                  {photo.caption ? ` — ${photo.caption}` : ''}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="sect csheet__sign">
        <div className="csheet__party">
          <p className="lbl">For {entry.org_name}</p>
          {supervisor ? (
            <figure className="csheet__drawn">
              <img src={supervisor.src} alt="" />
              <figcaption>{supervisor.name}</figcaption>
            </figure>
          ) : (
            <p className="csheet__name">{entry.author_name}</p>
          )}
          <p className="mono csheet__meta">Signed {formatInstant(entry.signed_at)}</p>
        </div>
        <div className="csheet__party">
          <p className="lbl">For the client / principal</p>
          {client ? (
            <>
              <figure className="csheet__drawn">
                <img src={client.src} alt="" />
                <figcaption>{client.name}</figcaption>
              </figure>
              <p className="mono csheet__meta">Signed on site</p>
            </>
          ) : (
            <>
              <p className="csheet__field"><span className="lbl">Name</span><span className="csheet__line" /></p>
              <p className="csheet__field"><span className="lbl">Signature</span><span className="csheet__line csheet__line--tall" /></p>
              <p className="csheet__field"><span className="lbl">Date</span><span className="csheet__line" /></p>
            </>
          )}
        </div>
      </section>

      <section className="sig">
        <p className="lbl">Record</p>
        <p className="src">
          Drawn from signed site diary entry {entry.entry_no}, {fmtDate(entry.entry_date)}. The diary entry is
          immutable; its content hash is {entry.content_hash ?? '—'}. Verify this document at
          kbsdailydiary.me/verify.
        </p>
      </section>
    </article>
  );
}

export const CLIENT_SHEET_CSS = `
.csheet__sign { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 6mm; }
.csheet__party { min-height: 34mm; }
.csheet__name { margin: 2mm 0 0; font-size: 11pt; }
.csheet__meta { margin: 1mm 0 0; font-size: 8pt; color: #5A6469; }
.csheet__drawn { margin: 1mm 0 0; }
.csheet__drawn img { height: 16mm; width: auto; max-width: 100%; display: block; border-bottom: 0.6pt solid #131A1E; background: #fff; }
.csheet__drawn figcaption { margin-top: 1mm; font-size: 9pt; }
.csheet__field { display: flex; align-items: flex-end; gap: 3mm; margin: 0 0 3mm; }
.csheet__field .lbl { flex: 0 0 18mm; margin: 0; }
.csheet__line { flex: 1; display: block; height: 6mm; border-bottom: 0.6pt solid #131A1E; }
.csheet__line--tall { height: 12mm; }
`;
