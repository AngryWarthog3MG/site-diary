'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';

/**
 * The org's next job, opened from the phone. The creator is seated as the
 * project's first admin; everyone else joins through Settings → Members.
 */
export function NewProjectForm({
  orgId,
  orgName,
  orgCode,
}: {
  orgId: string;
  orgName: string;
  orgCode: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contractor, setContractor] = useState('');
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
      });
      if (rpcError) throw new Error(rpcError.message);
      router.push(`/?project=${(data as { project_id: string }).project_id}`);
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
        be set afterwards in Settings.
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
        <span className="label">Principal contractor (optional)</span>
        <input
          className="field"
          value={contractor}
          placeholder="Lendlease"
          onChange={(e) => setContractor(e.target.value)}
        />
      </label>
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
        Back to today
      </Link>
    </main>
  );
}
