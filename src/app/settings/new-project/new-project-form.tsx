'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';
import { TIERS, TIER_LABEL, type Tier } from '@/lib/templates/model';

export interface ModuleChoice { key: string; name: string; description: string | null }

/**
 * The org's next job, opened from the phone. The creator is seated as the
 * project's first admin; everyone else joins through Settings → Members.
 * The job is born stamped from the company's templates at the tier and with
 * the modules chosen here (README R92); both can grow later on the board.
 */
export function NewProjectForm({
  orgId,
  orgName,
  orgCode,
  modules,
  libraryItems,
}: {
  orgId: string;
  orgName: string;
  orgCode: string;
  modules: ModuleChoice[];
  libraryItems: number;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contractor, setContractor] = useState('');
  const [tier, setTier] = useState<Tier>('full');
  const [picked, setPicked] = useState<string[]>([]);
  const [startOn, setStartOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('create_project', {
        p_org_id: orgId,
        p_name: name,
        p_code: code.toUpperCase().trim(),
        p_principal_contractor: contractor || null,
        p_tier: tier,
        p_modules: picked,
        p_start_on: startOn || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      router.push(`/mobilisation?project=${(data as { project_id: string }).project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The project was not created.');
      setBusy(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {orgName}
      </p>
      <h1 className="page-title">New job</h1>
      <p className="page-subtitle">
        Serials will read {orgCode}-{'{date}'}. Site coordinates and the weather station can
        be set afterwards in Settings. The job starts with what the company&rsquo;s templates say a job needs.
      </p>
      <hr className="rule" />
      <label className="fieldcell">
        <span className="label">Project name</span>
        <input
          className="field"
          value={name}
          placeholder="Scarborough Foreshore Stage 1"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="fieldcell">
        <span className="label">Project code (2–12 letters/digits)</span>
        <input
          className="field field--sm"
          value={code}
          placeholder="C002"
          maxLength={12}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>
      <label className="fieldcell">
        <span className="label">Head contractor (optional)</span>
        <input
          className="field"
          value={contractor}
          placeholder="Lendlease"
          onChange={(e) => setContractor(e.target.value)}
        />
      </label>
      <label className="fieldcell">
        <span className="label">Start date (optional — due dates count from it)</span>
        <input className="field field--sm" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">Tier</span>
        <select className="field" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </select>
      </label>
      <p className="label">Modules</p>
      {libraryItems === 0 && (
        <p className="caption">The company&rsquo;s template library is empty, so the job will start with an empty board. <Link href="/templates">Fill the templates</Link> when you can; the board can be re-stamped later.</p>
      )}
      <div className="setup__mods">
        {modules.map((m) => (
          <label key={m.key} className="setup__mod">
            <input
              type="checkbox"
              checked={m.key === 'core' || picked.includes(m.key)}
              disabled={m.key === 'core'}
              onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key)))}
            />
            <span><strong>{m.name}</strong>{m.key === 'core' ? ' — every job' : m.description ? ` — ${m.description}` : ''}</span>
          </label>
        ))}
      </div>
      {error && <p className="alert">{error}</p>}
      <button
        className="button"
        type="button"
        disabled={busy || !name.trim() || !code.trim()}
        onClick={create}
      >
        {busy ? 'Creating…' : 'Create the project'}
      </button>
      <Link className="button button--quiet" href="/">
        Home
      </Link>
    </main>
  );
}
