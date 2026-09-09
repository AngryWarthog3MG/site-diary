import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { readChecks, PLANT_KIND_LABEL, isPlantKind } from '@/lib/plant/checklist';
import { PdfLink } from './pdf-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plant prestart · KBS Daily Diary' };

export default async function PlantPrestartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();
  const { data: row } = await supabase
    .from('plant_prestarts')
    .select(`id, project_id, prestart_date, operator_name, hour_meter, checks, fit_for_use, notes, signature_path, completed_at,
             plant:plant_register!inner(name, kind, plant_no, make_model), project:projects!inner(name)`)
    .eq('id', id).maybeSingle();
  if (!row) notFound();
  const first = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const plant = first(row.plant) as { name: string; kind: string; plant_no: string | null; make_model: string | null };
  const project = first(row.project) as { name: string };
  const checks = readChecks(row.checks);
  const { data: defects } = await supabase.from('plant_defects').select('id, item_label, note, photo_path, closed_at, closed_note').eq('prestart_id', id).order('raised_at');
  const paths = [row.signature_path as string | null, ...(defects ?? []).map((d) => d.photo_path as string | null)].filter((p): p is string => Boolean(p));
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('entry-photos').createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  const done = Boolean(row.completed_at);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <h1 className="page-title">{plant.name}</h1>
      <p className="page-subtitle mono">
        {fmtDate(row.prestart_date as string)} · {[isPlantKind(plant.kind) ? PLANT_KIND_LABEL[plant.kind] : plant.kind, plant.plant_no, plant.make_model].filter(Boolean).join(' · ')}
      </p>
      <p>
        <span className={`status-pill ${row.fit_for_use ? 'status-pill--ready' : 'status-pill--danger'}`}>{row.fit_for_use ? 'Fit for use' : 'Not to be used'}</span>
        {!done && <span className="status-pill status-pill--gap" style={{ marginLeft: '0.5rem' }}>Not signed</span>}
      </p>
      <hr className="rule" />
      <div className="grid-2">
        <div><p className="label">Operator</p><p style={{ margin: '0.25rem 0 0' }}>{row.operator_name as string}</p></div>
        <div><p className="label">Hour meter</p><p className="mono" style={{ margin: '0.25rem 0 0' }}>{row.hour_meter == null ? '—' : Number(row.hour_meter).toFixed(1)}</p></div>
      </div>
      <hr className="rule" />
      <p className="label">Checks</p>
      <ul className="tri-list tri-list--read">
        {checks.map((c) => (
          <li key={c.key} className={`tri tri--${c.result}`}>
            <p className="tri__label">{c.label}</p>
            <span className={`tri__result tri__result--${c.result}`}>{c.result === 'ok' ? 'OK' : c.result === 'defect' ? 'Defect' : 'N/A'}</span>
          </li>
        ))}
      </ul>
      {(defects ?? []).length > 0 && (
        <>
          <hr className="rule" />
          <p className="label">Defects</p>
          <ul className="defects">
            {(defects ?? []).map((d) => (
              <li key={d.id as string} className="defect">
                <div>
                  <p className="machine__name">{d.item_label as string}</p>
                  <p className="machine__meta">{(d.note as string | null) ?? 'No note'}{d.closed_at ? ` · closed${d.closed_note ? `: ${d.closed_note}` : ''}` : ' · open'}</p>
                  {d.photo_path && urls[d.photo_path as string] && <img className="defect__photo" src={urls[d.photo_path as string]} alt="" />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {row.notes && (<><hr className="rule" /><p className="label">Notes</p><p>{row.notes as string}</p></>)}
      <hr className="rule" />
      <p className="label">Operator&rsquo;s signature</p>
      {row.signature_path && urls[row.signature_path as string]
        ? <img className="sigimg" src={urls[row.signature_path as string]} alt="" />
        : <p className="caption">Not signed.</p>}
      {done && <PdfLink id={id} />}
      <Link className="button button--quiet" href={`/plant?project=${row.project_id}`}>All plant</Link>
    </main>
  );
}
