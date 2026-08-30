'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SECTIONS, PHOTO_FIELDS, type FieldDef, type SectionDef } from '@/lib/review/fields';
import {
  GAP_PROMPTS,
  WARNING_PROMPTS,
  reviewBlockingGaps,
  type ItemGroup,
  type ReviewPayload,
} from '@/lib/review/schema';
import { SECTION_KEYS, type SectionKey } from '@/lib/extraction/schema';
import {
  reconcilePour,
  type DocketChange,
  type DocketRead,
  type PourLike,
} from '@/lib/docket/reconcile';
import type { ReviewWeather } from './page';

type Item = Record<string, unknown>;

const SECTION_QUESTIONS: Record<SectionKey, string> = {
  labour: 'Nobody recorded on labour today — is that right?',
  plant: 'Nothing on plant today — is that right?',
  work_items: 'Nothing recorded as completed today — is that right?',
  variations: 'No variations today — is that right?',
  delays: 'No delays today — is that right?',
  weather: 'Did the weather affect the work today?',
};

/** The six required sections map onto these groups; pours and quantities are extra. */
const REQUIRED_GROUP: Partial<Record<SectionKey, ItemGroup>> = {
  labour: 'labour',
  plant: 'plant',
  work_items: 'work_items',
  variations: 'variations',
  delays: 'delays',
};

const PHOTO_BUCKET = 'entry-photos';

export function ReviewScreen(props: {
  entryId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  entryDate: string;
  transcript: string | null;
  initial: ReviewPayload;
  initialNilConfirmed: SectionKey[];
  weather: ReviewWeather | null;
  hasProposal: boolean;
  hasStored: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<ReviewPayload>(props.initial);
  const [nilConfirmed, setNilConfirmed] = useState<Set<SectionKey>>(
    new Set(props.initialNilConfirmed),
  );
  const [busy, setBusy] = useState<null | 'saving' | 'signing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  const gaps = useMemo(() => reviewBlockingGaps(payload), [payload]);

  /**
   * Autosave, debounced.
   *
   * Edits used to live only in this page's memory until Sign or "Save and
   * finish later" — so a stale tab, a crash or a dead battery ate them. A
   * supervisor's typed VR reference is part of the record's raw material;
   * losing it to a page reload is not acceptable. Every change now applies
   * to the draft a few seconds after they stop typing. Best effort and
   * silent: a failed autosave changes nothing visible, because Sign still
   * applies everything it can see.
   */
  const skipFirstAutosave = useRef(true);
  useEffect(() => {
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    if (busy) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/entries/${props.entryId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, sections: sectionsForSubmit() }),
      }).catch(() => {});
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, nilConfirmed]);

  const update = useCallback((group: ItemGroup, index: number, key: string, value: unknown) => {
    setPayload((prev) => {
      const items = [...(prev[group] as Item[])];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, [group]: items };
    });
  }, []);

  // Several fields at once — a docket read can overrule volume, mix and
  // supplier in the same breath, and applying them one keystroke at a time
  // would race the autosave.
  const patchItem = useCallback((group: ItemGroup, index: number, patch: Item) => {
    setPayload((prev) => {
      const items = [...(prev[group] as Item[])];
      items[index] = { ...items[index], ...patch };
      return { ...prev, [group]: items };
    });
  }, []);

  const addItem = useCallback((section: SectionDef) => {
    setPayload((prev) => ({
      ...prev,
      [section.group]: [...(prev[section.group] as Item[]), section.blank()],
    }));
    // Adding something answers the question.
    setNilConfirmed((prev) => {
      const next = new Set(prev);
      for (const [key, group] of Object.entries(REQUIRED_GROUP)) {
        if (group === section.group) next.delete(key as SectionKey);
      }
      return next;
    });
  }, []);

  const removeItem = useCallback((group: ItemGroup, index: number) => {
    setPayload((prev) => ({
      ...prev,
      [group]: (prev[group] as Item[]).filter((_, i) => i !== index),
    }));
  }, []);

  function sectionsForSubmit() {
    return SECTION_KEYS.map((key) => {
      const group = REQUIRED_GROUP[key];
      const count = group
        ? (payload[group] as Item[]).length
        : payload.weather_impact?.trim()
          ? 1
          : 0;

      const state = count > 0 ? 'captured' : nilConfirmed.has(key) ? 'nil_confirmed' : 'gap';
      return { section: key, state, note: null } as const;
    });
  }

  async function submit(mode: 'saving' | 'signing') {
    setBusy(mode);
    setError(null);
    setWarnings([]);

    const body = { ...payload, sections: sectionsForSubmit() };
    const url =
      mode === 'signing'
        ? `/api/entries/${props.entryId}/sign`
        : `/api/entries/${props.entryId}/apply`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(json?.error?.message ?? 'That did not save. Nothing was lost — try again.');
        return;
      }

      if (mode === 'signing') {
        router.push(`/entries/${props.entryId}/signed`);
        return;
      }

      router.push('/');
      return;
    } catch {
      setError('No signal. Nothing was saved — your recording is still safe on this phone.');
    } finally {
      setBusy(null);
    }
  }

  const unanswered = SECTION_KEYS.filter((key) => {
    const group = REQUIRED_GROUP[key];
    const count = group
      ? (payload[group] as Item[]).length
      : payload.weather_impact?.trim()
        ? 1
        : 0;
    return count === 0 && !nilConfirmed.has(key);
  });

  return (
    <main className="sheet">
      <p className="label">{props.projectName}</p>
      <p className="mono" style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)' }}>
        {props.projectCode} · {props.entryDate}
      </p>
      <h1 style={{ margin: '0.5rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>Review</h1>
      <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
        {props.hasStored
          ? 'Your saved entry. Change anything that is not right.'
          : props.hasProposal
            ? 'Taken from your recording. Nothing here is on the record until you sign it.'
            : 'Nothing extracted yet. Add what happened by hand.'}
      </p>

      {props.hasProposal && !props.hasStored && payload.labour.length === 0 &&
        payload.plant.length === 0 && payload.work_items.length === 0 &&
        payload.variations.length === 0 && payload.delays.length === 0 &&
        payload.pours.length === 0 && payload.quantities.length === 0 && (
        <p className="notice" style={{ marginTop: '1rem' }}>
          Nothing in the recording described work that had already happened, so nothing was
          put in the entry — the diary records what was done, not what is planned. Add items
          by hand below, or record again at knock-off and this fills itself in.
        </p>
      )}

      {props.transcript && (
        <>
          <button
            type="button"
            className="quotebtn"
            onClick={() => setShowTranscript((v) => !v)}
            style={{ marginTop: '0.75rem' }}
          >
            {showTranscript ? 'Hide transcript' : 'Show full transcript'}
          </button>
          {showTranscript && <blockquote className="quote">{props.transcript}</blockquote>}
        </>
      )}

      {gaps.length > 0 && (
        <div className="notice gap" style={{ marginTop: '1rem' }}>
          <p className="label" style={{ color: 'var(--amber)', margin: 0 }}>
            Before you can sign
          </p>
          <ul className="gaplist">
            {gaps.map((gap) => (
              <li key={gap}>{GAP_PROMPTS[gap]?.short ?? gap}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.map((warning) => (
        <p key={warning} className="notice gap">
          {WARNING_PROMPTS[warning] ?? warning}
        </p>
      ))}

      {SECTIONS.map((section) => (
        <DocketSection
          key={section.group}
          section={section}
          reasons={gaps
            .filter((gap) => GAP_PROMPTS[gap]?.group === section.group)
            .map((gap) => `${GAP_PROMPTS[gap].short}. ${GAP_PROMPTS[gap].why}`)}
          items={payload[section.group] as Item[]}
          projectId={props.projectId}
          entryId={props.entryId}
          onChange={update}
          onPatch={patchItem}
          onAdd={addItem}
          onRemove={removeItem}
        />
      ))}

      <WeatherBlock
        weather={props.weather}
        impact={payload.weather_impact}
        onChange={(value) => setPayload((prev) => ({ ...prev, weather_impact: value }))}
      />

      <section style={{ marginTop: '1.5rem' }}>
        <hr className="rule" />
        <p className="label">Additional notes</p>
        <p style={{ margin: '0.25rem 0 0.5rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
          Anything worth recording that fits no section above. Part of the signed record.
        </p>
        <label className="fieldcell">
          <textarea
            className="field field--sm"
            rows={3}
            value={payload.notes ?? ''}
            placeholder="Toolbox talk held. Concrete booked for Thursday."
            onChange={(e) =>
              setPayload((prev) => ({ ...prev, notes: e.target.value === '' ? null : e.target.value }))
            }
          />
        </label>
      </section>

      {unanswered.length > 0 && (
        <>
          <hr className="rule" />
          <p className="label">Still to answer</p>
          {unanswered.map((key) => (
            <div key={key} className="notice gap" style={{ marginTop: '0.5rem' }}>
              <p style={{ margin: 0 }}>{SECTION_QUESTIONS[key]}</p>
              <button
                type="button"
                className="button button--quiet"
                style={{ marginTop: '0.5rem' }}
                onClick={() =>
                  setNilConfirmed((prev) => {
                    const next = new Set(prev);
                    next.add(key);
                    return next;
                  })
                }
              >
                {key === 'weather' ? 'No — it made no difference' : 'Correct — nothing today'}
              </button>
            </div>
          ))}
        </>
      )}

      <hr className="rule" />

      {error && <p className="alert">{error}</p>}

      <button
        type="button"
        className="button"
        disabled={busy !== null || gaps.length > 0}
        onClick={() => submit('signing')}
      >
        {busy === 'signing' ? 'Signing…' : 'Sign this entry'}
      </button>

      {gaps.length > 0 && (
        <p style={{ marginTop: '0.5rem', color: 'var(--amber)', fontSize: '0.875rem' }}>
          {gaps.length} thing{gaps.length === 1 ? '' : 's'} to clear before you can sign.
        </p>
      )}

      <button
        type="button"
        className="button button--quiet"
        disabled={busy !== null}
        onClick={() => submit('saving')}
      >
        {busy === 'saving' ? 'Saving…' : 'Save and finish later'}
      </button>

      <p style={{ marginTop: '1.5rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
        Signing is final. A signed entry cannot be edited — a correction is a new entry that
        refers back to this one.
      </p>

      <Link className="button button--quiet" href="/">
        Back to today
      </Link>
    </main>
  );
}

function DocketSection({
  section,
  reasons,
  items,
  projectId,
  entryId,
  onChange,
  onPatch,
  onAdd,
  onRemove,
}: {
  section: SectionDef;
  reasons: string[];
  items: Item[];
  projectId: string;
  entryId: string;
  onChange: (group: ItemGroup, index: number, key: string, value: unknown) => void;
  onPatch: (group: ItemGroup, index: number, patch: Item) => void;
  onAdd: (section: SectionDef) => void;
  onRemove: (group: ItemGroup, index: number) => void;
}) {
  return (
    <section style={{ marginTop: '1.5rem' }}>
      <hr className="rule" />
      <p className="label">
        {section.title} {items.length > 0 && <span className="mono">· {items.length}</span>}
      </p>

      {reasons.map((reason) => (
        <p key={reason} className="notice gap" style={{ marginTop: '0.5rem' }}>
          {reason}
        </p>
      ))}

      {items.length === 0 && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-30)', fontSize: '0.9375rem' }}>
          Nothing recorded.
        </p>
      )}

      {items.map((item, index) => (
        <ItemCard
          key={index}
          section={section}
          item={item}
          index={index}
          projectId={projectId}
          entryId={entryId}
          onChange={onChange}
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ))}

      <button
        type="button"
        className="button button--quiet"
        style={{ marginTop: '0.75rem' }}
        onClick={() => onAdd(section)}
      >
        Add {section.noun}
      </button>
    </section>
  );
}

type DocketState =
  | { status: 'reading' }
  | { status: 'done'; changes: DocketChange[]; issue: string | null }
  | { status: 'failed'; message: string };

function ItemCard({
  section,
  item,
  index,
  projectId,
  entryId,
  onChange,
  onPatch,
  onRemove,
}: {
  section: SectionDef;
  item: Item;
  index: number;
  projectId: string;
  entryId: string;
  onChange: (group: ItemGroup, index: number, key: string, value: unknown) => void;
  onPatch: (group: ItemGroup, index: number, patch: Item) => void;
  onRemove: (group: ItemGroup, index: number) => void;
}) {
  const [showQuote, setShowQuote] = useState(false);
  const [docket, setDocket] = useState<DocketState | null>(null);
  const quote = item.source_quote as string | null;
  const low = item.confidence === 'low';

  /**
   * A new docket photo on a pour gets read straight away (brief §4): OCR the
   * m³, mix and docket number, and where the docket differs from what was
   * spoken, the docket wins — with the difference shown, not slipped in.
   */
  async function readDocket(path: string, pourAtUpload: Item) {
    setDocket({ status: 'reading' });
    try {
      const response = await fetch(`/api/entries/${entryId}/docket-ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_path: path }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDocket({
          status: 'failed',
          message: json?.error?.message ?? 'The docket could not be read. The photo is kept.',
        });
        return;
      }
      const read = json.read as DocketRead;
      if (!read.legible) {
        setDocket({
          status: 'failed',
          message: `Could not read that as a docket${read.issue ? ` — ${read.issue}` : ''}. The photo is kept; enter the figures by hand.`,
        });
        return;
      }
      const { patch, changes } = reconcilePour(pourAtUpload as PourLike, read);
      if (Object.keys(patch).length > 0) onPatch(section.group, index, patch as Item);
      setDocket({ status: 'done', changes, issue: read.issue });
    } catch {
      setDocket({ status: 'failed', message: 'No signal — the photo is kept, try the read again later.' });
    }
  }

  return (
    <article className={`item${low ? ' item--low' : ''}`}>
      {low && (
        <p className="label" style={{ color: 'var(--amber)' }}>
          Check this one
        </p>
      )}

      <div className="fieldgrid">
        {section.fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            fieldId={`${section.group}-${index}-${field.key}`}
            value={item[field.key]}
            projectId={projectId}
            entryId={entryId}
            onChange={(value) => {
              onChange(section.group, index, field.key, value);
              if (section.group === 'pours' && field.key === 'docket_photo_urls') {
                const previous = (item[field.key] as string[] | null) ?? [];
                const next = (value as string[] | null) ?? [];
                const added = next.find((path) => !previous.includes(path));
                if (added) void readDocket(added, item);
              }
            }}
          />
        ))}
      </div>

      {docket?.status === 'reading' && (
        <p className="notice" style={{ marginTop: '0.5rem' }}>
          Reading the docket…
        </p>
      )}
      {docket?.status === 'failed' && (
        <p className="notice gap" style={{ marginTop: '0.5rem' }}>
          {docket.message}
        </p>
      )}
      {docket?.status === 'done' && (
        <div className="notice" style={{ marginTop: '0.5rem' }}>
          {docket.changes.length === 0 ? (
            <p style={{ margin: 0 }}>Docket read — it agrees with what was said.</p>
          ) : (
            <>
              <p className="label" style={{ margin: 0 }}>
                From the docket — the docket wins
              </p>
              <ul className="gaplist">
                {docket.changes.map((change) => (
                  <li key={change.field}>
                    {change.label}: {change.from} → <strong>{change.to}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          {docket.issue && <p style={{ margin: '0.25rem 0 0' }}>{docket.issue}</p>}
        </div>
      )}

      <div className="itemfoot">
        {quote ? (
          <button type="button" className="quotebtn" onClick={() => setShowQuote((v) => !v)}>
            {showQuote ? 'Hide what was said' : 'What was said'}
          </button>
        ) : (
          <span className="quotebtn quotebtn--muted">Added by hand</span>
        )}
        <button
          type="button"
          className="quotebtn quotebtn--remove"
          onClick={() => onRemove(section.group, index)}
        >
          Remove
        </button>
      </div>

      {showQuote && quote && <blockquote className="quote">“{quote}”</blockquote>}
    </article>
  );
}

function Field({
  field,
  fieldId,
  value,
  projectId,
  entryId,
  onChange,
}: {
  field: FieldDef;
  fieldId: string;
  value: unknown;
  projectId: string;
  entryId: string;
  onChange: (value: unknown) => void;
}) {
  const id = fieldId;

  if (field.kind === 'list') {
    return (
      <ListField
        field={field}
        value={(value as string[] | null) ?? []}
        projectId={projectId}
        entryId={entryId}
        onChange={onChange}
      />
    );
  }

  const common = {
    id,
    className: 'field field--sm',
    value: value == null ? '' : String(value),
  };

  return (
    <label className={field.narrow ? 'fieldcell fieldcell--narrow' : 'fieldcell'} htmlFor={id}>
      <span className="label">
        {field.label}
        {field.suffix ? ` (${field.suffix})` : ''}
      </span>

      {field.kind === 'textarea' ? (
        <textarea
          {...common}
          rows={2}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      ) : field.kind === 'select' ? (
        <select {...common} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={field.kind === 'number' ? 'number' : field.kind === 'time' ? 'time' : field.kind === 'datetime' ? 'datetime-local' : 'text'}
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          step={field.step}
          placeholder={field.placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(null);
            } else if (field.kind === 'number') {
              const parsed = Number(raw);
              onChange(Number.isFinite(parsed) ? parsed : null);
            } else {
              onChange(raw);
            }
          }}
        />
      )}
    </label>
  );
}

function ListField({
  field,
  value,
  projectId,
  entryId,
  onChange,
}: {
  field: FieldDef;
  value: string[];
  projectId: string;
  entryId: string;
  onChange: (value: string[]) => void;
}) {
  const isPhotos = PHOTO_FIELDS.has(field.key);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createClient();
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${projectId}/${entryId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) throw new Error(error.message);
      onChange([...value, path]);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? `Photo did not upload: ${err.message}`
          : 'Photo did not upload.',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fieldcell">
      <span className="label">{field.label}</span>

      {value.length > 0 && (
        <ul className="chips" style={{ marginBottom: '0.5rem' }}>
          {value.map((entry) => (
            <li key={entry} className="chip chip--on">
              {isPhotos ? entry.split('/').pop()?.slice(0, 8) : entry}
              <button
                type="button"
                className="chipx"
                aria-label={`Remove ${entry}`}
                onClick={() => onChange(value.filter((v) => v !== entry))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPhotos ? (
        <>
          <label className="button button--quiet" style={{ marginTop: 0 }}>
            {uploading ? 'Uploading…' : 'Take photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
          </label>
          {uploadError && <p className="alert">{uploadError}</p>}
        </>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="field field--sm"
            value={text}
            placeholder="Add"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="button button--quiet"
            style={{ marginTop: 0, width: 'auto', padding: '0 1rem' }}
            onClick={() => {
              const trimmed = text.trim();
              if (!trimmed) return;
              onChange([...value, trimmed]);
              setText('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function WeatherBlock({
  weather,
  impact,
  onChange,
}: {
  weather: ReviewWeather | null;
  impact: string | null;
  onChange: (value: string | null) => void;
}) {
  const n = (value: number | null, unit: string, digits = 1) =>
    value == null ? '—' : `${value.toFixed(digits)}${unit}`;

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <hr className="rule" />
      <p className="label">Weather</p>

      <p className="mono" style={{ margin: '0.5rem 0 0' }}>
        {weather
          ? `${n(weather.temp_min, '°')} / ${n(weather.temp_max, '°')} · ${n(
              weather.rainfall_mm,
              ' mm',
            )} · ${weather.wind_dir ?? '—'} ${n(weather.wind_kmh, ' km/h', 0)}`
          : '—'}
      </p>
      {weather?.station_name && (
        <p className="mono" style={{ margin: 0, color: 'var(--ink-60)', fontSize: '0.75rem' }}>
          {weather.station_name}
          {weather.station_distance_km != null
            ? ` · ${weather.station_distance_km.toFixed(1)} km from site`
            : ''}
        </p>
      )}
      <p style={{ margin: '0.25rem 0 0.75rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
        Readings come from the Bureau of Meteorology and are not editable.
      </p>

      <label className="fieldcell">
        <span className="label">What it did to the work</span>
        <textarea
          className="field field--sm"
          rows={2}
          value={impact ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      </label>
    </section>
  );
}
