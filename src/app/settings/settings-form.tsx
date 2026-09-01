'use client';

import { useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export interface SettingsData {
  orgId: string;
  orgName: string;
  orgCode: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  principalContractor: string | null;
  siteLat: number | null;
  siteLng: number | null;
  bomStationId: string | null;
  active: boolean;
  reportEmails: string;
  canEdit: boolean;
  codeLocked: boolean;
  orgCodeLocked: boolean;
  signedEntries: number;
}

const CODE_HINT = 'Letters and digits only. It becomes part of every entry number.';

export function SettingsForm({ initial }: { initial: SettingsData }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const today = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  const nextEntryNo = `${form.orgCode || '??'}-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const clean = (value: string | null) => {
      const text = (value ?? '').trim();
      return text === '' ? null : text;
    };

    try {
      const orgPatch: Record<string, unknown> = { name: form.orgName.trim() };
      if (!form.orgCodeLocked) orgPatch.code = form.orgCode.trim().toUpperCase();

      const { error: orgError } = await supabase
        .from('organisations')
        .update(orgPatch)
        .eq('id', form.orgId);
      if (orgError) throw new Error(orgError.message);

      const projectPatch: Record<string, unknown> = {
        report_emails: form.reportEmails
          .split(/[,;\s]+/)
          .map((address) => address.trim().toLowerCase())
          .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)),
        name: form.projectName.trim(),
        principal_contractor: clean(form.principalContractor),
        site_lat: form.siteLat,
        site_lng: form.siteLng,
        bom_station_id: clean(form.bomStationId),
        active: form.active,
      };
      if (!form.codeLocked) projectPatch.code = form.projectCode.trim().toUpperCase();

      const { error: projectError } = await supabase
        .from('projects')
        .update(projectPatch)
        .eq('id', form.projectId);
      if (projectError) throw new Error(projectError.message);

      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const locked = !form.canEdit;

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet">
      <header className="page-header">
        <div>
          <p className="label">Settings</p>
          <h1 className="page-title"><BrandMark size={22} /> {form.projectName || 'Project'}</h1>
          <p className="mono page-subtitle">Next entry: {nextEntryNo}</p>
        </div>
      </header>

      {locked && (
        <p className="notice" style={{ marginTop: '1rem' }}>
          You are on this project as a supervisor. Settings are shown for reference; only an
          admin can change them.
        </p>
      )}

      {form.canEdit && (
        <div className="settings-actions">
          <Link className="button button--quiet" href={`/settings/members?project=${form.projectId}`}>
            Manage members
          </Link>
          <Link className="button button--quiet" href={`/settings/vocabulary?project=${form.projectId}`}>
            Manage vocabulary
          </Link>
          <Link className="button button--quiet" href={`/settings/new-project?project=${form.projectId}`}>
            New job for {form.orgName}
          </Link>
        </div>
      )}

      {form.canEdit && (
        <label className="fieldcell">
          <span className="label">Weekly report emails</span>
          <input
            className="field"
            value={form.reportEmails}
            placeholder="pm@example.com, ca@example.com"
            onChange={(e) => set('reportEmails', e.target.value)}
          />
          <span className="fieldhint">
            Every Friday at knock-off, the week&apos;s signed report is emailed here
            automatically. Leave empty for no automatic send.
          </span>
        </label>
      )}

      <hr className="rule" />

      <p className="label">Organisation</p>
      <Field
        label="Name"
        value={form.orgName}
        disabled={locked}
        onChange={(v) => set('orgName', v)}
      />
      <Field
        label="Code"
        value={form.orgCode}
        disabled={locked || form.orgCodeLocked}
        mono
        hint={
          form.orgCodeLocked
            ? `Fixed — ${form.signedEntries} signed ${
                form.signedEntries === 1 ? 'entry carries' : 'entries carry'
              } this prefix.`
            : CODE_HINT
        }
        onChange={(v) => set('orgCode', v.toUpperCase())}
      />

      <hr className="rule" />

      <p className="label">Project</p>
      <Field
        label="Name"
        value={form.projectName}
        disabled={locked}
        onChange={(v) => set('projectName', v)}
      />
      <Field
        label="Code"
        value={form.projectCode}
        disabled={locked || form.codeLocked}
        mono
        hint={
          form.codeLocked
            ? `Fixed — ${form.signedEntries} signed ${
                form.signedEntries === 1 ? 'entry carries' : 'entries carry'
              } this prefix. Set up a new project instead.`
            : CODE_HINT
        }
        onChange={(v) => set('projectCode', v.toUpperCase())}
      />
      <Field
        label="Principal contractor"
        value={form.principalContractor ?? ''}
        disabled={locked}
        onChange={(v) => set('principalContractor', v)}
      />

      <hr className="rule" />

      <p className="label">Site</p>
      <p style={{ margin: '0.25rem 0 0.5rem', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
        Coordinates are what the weather is fetched for. Without them the diary has no weather
        at all.
      </p>
      <div className="fieldgrid">
        <NumberField
          label="Latitude"
          value={form.siteLat}
          disabled={locked}
          onChange={(v) => set('siteLat', v)}
        />
        <NumberField
          label="Longitude"
          value={form.siteLng}
          disabled={locked}
          onChange={(v) => set('siteLng', v)}
        />
      </div>
      <Field
        label="BOM station"
        value={form.bomStationId ?? ''}
        disabled={locked}
        mono
        hint="Optional. Pins a weather station by its WMO or BOM id; otherwise the nearest reporting station is used."
        onChange={(v) => set('bomStationId', v)}
      />

      <hr className="rule" />

      <label className="fieldcell" style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={form.active}
          disabled={locked}
          onChange={(e) => set('active', e.target.checked)}
          style={{ width: 22, height: 22 }}
        />
        <span>Active — appears on the Today screen</span>
      </label>

      <hr className="rule" />

      {error && <p className="alert">{error}</p>}
      {saved && <p className="notice">Saved.</p>}

      {!locked && (
        <button className="button" type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}

      <Link className="button button--quiet" href="/">
        Back to today
      </Link>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  disabled,
  hint,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
      <span className="label">{label}</span>
      <input
        className={`field field--sm${mono ? ' mono' : ''}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <span style={{ display: 'block', marginTop: '0.25rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="fieldcell fieldcell--narrow" style={{ marginTop: '0.75rem' }}>
      <span className="label">{label}</span>
      <input
        className="field field--sm mono"
        type="number"
        step="0.0001"
        inputMode="decimal"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(null);
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
    </label>
  );
}
