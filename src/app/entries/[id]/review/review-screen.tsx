'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SECTIONS, PHOTO_FIELDS, type FieldDef, type SectionDef } from '@/lib/review/fields';
import {
  GAP_PROMPTS,
  PHOTO_CATEGORIES,
  WARNING_GROUPS,
  WARNING_PROMPTS,
  reviewBlockingGaps,
  reviewQualityWarnings,
  type ItemGroup,
  type PhotoCategory,
  type ReviewPhoto,
  type ReviewSignature,
  type ReviewWeatherReading,
  type ReviewPayload,
} from '@/lib/review/schema';
import { SECTION_KEYS, type SectionKey } from '@/lib/extraction/schema';
import {
  reconcilePour,
  type DocketChange,
  type DocketRead,
  type PourLike,
} from '@/lib/docket/reconcile';
import { compressPhoto } from '@/lib/photos/compress';
import { BrandMark } from '@/components/brand-mark';
import { SignaturePad } from '@/components/signature-pad';
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
type ReviewTab = ItemGroup | 'photos' | 'weather' | 'notes' | 'signoff';
const REVIEW_TABS: Array<{ key: ReviewTab; label: string }> = [
  ...SECTIONS.map((section) => ({ key: section.group, label: section.title })),
  { key: 'photos', label: 'Photos' },
  { key: 'weather', label: 'Weather' },
  { key: 'notes', label: 'Notes' },
  { key: 'signoff', label: 'Sign-off' },
];

/**
 * One signing request for a batch of storage paths instead of one per photo.
 * A review with a dozen photos on a weak on-site connection should not fire
 * a dozen separate calls for thumbnails.
 */
function useSignedUrls(paths: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('\n');
  useEffect(() => {
    if (!key) {
      setUrls({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(key.split('\n'), 3600);
      if (!cancelled) {
        const next: Record<string, string> = {};
        for (const row of data ?? []) {
          if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
        }
        setUrls(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
}

const PHOTO_LABELS: Record<PhotoCategory, string> = {
  progress: 'Progress',
  works: 'Works',
  delay: 'Delay',
  variation: 'Variation',
  pour: 'Pour',
  safety: 'Safety',
  general: 'General',
};

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
  const [showTranscript, setShowTranscript] = useState(false);
  const [activeTab, setActiveTab] = useState<ReviewTab>('labour');

  const gaps = useMemo(() => reviewBlockingGaps(payload), [payload]);
  const qualityWarnings = useMemo(() => reviewQualityWarnings(payload), [payload]);
  const gapGroups = useMemo(
    () => new Set(gaps.map((gap) => GAP_PROMPTS[gap]?.group).filter(Boolean) as ItemGroup[]),
    [gaps],
  );
  const warningTabs = useMemo(
    () => new Set(qualityWarnings.map((warning) => WARNING_GROUPS[warning]).filter(Boolean)),
    [qualityWarnings],
  );

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
        body: JSON.stringify(bodyForSubmit()),
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

  // Several rows at once — crew chips and copy-from-last-entry land as a
  // batch, and answer the section's nil question the same way adding one does.
  const bulkAdd = useCallback((group: ItemGroup, items: Item[]) => {
    if (items.length === 0) return;
    setPayload((prev) => ({
      ...prev,
      [group]: [...(prev[group] as Item[]), ...items],
    }));
    setNilConfirmed((prev) => {
      const next = new Set(prev);
      for (const [key, mapped] of Object.entries(REQUIRED_GROUP)) {
        if (mapped === group) next.delete(key as SectionKey);
      }
      return next;
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

  /**
   * The request body. The weather object is included only when it actually
   * holds a reading — an all-null weather block is not a manual entry, and
   * sending one would have the server treat prefilled emptiness as intent.
   */
  function bodyForSubmit() {
    const w = payload.weather;
    const hasReading =
      w != null &&
      (w.temp_max != null ||
        w.temp_min != null ||
        w.rainfall_mm != null ||
        w.wind_kmh != null ||
        Boolean(w.wind_dir?.trim()));
    const { weather: _weather, ...rest } = payload;
    return { ...rest, ...(hasReading ? { weather: w } : {}), sections: sectionsForSubmit() };
  }

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

    const body = bodyForSubmit();
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
  const unansweredSet = new Set(unanswered);
  const activeSection = SECTIONS.find((section) => section.group === activeTab);
  const activeReasons =
    activeSection == null
      ? []
      : gaps
          .filter((gap) => GAP_PROMPTS[gap]?.group === activeSection.group)
          .map((gap) => `${GAP_PROMPTS[gap].short}. ${GAP_PROMPTS[gap].why}`);

  function tabMeta(tab: ReviewTab) {
    if (tab === 'weather') {
      return {
        count: payload.weather_impact?.trim() ? 1 : 0,
        needsAnswer: unansweredSet.has('weather'),
        hasGap: warningTabs.has('weather'),
        low: false,
      };
    }
    if (tab === 'notes') {
      return {
        count: payload.notes?.trim() ? 1 : 0,
        needsAnswer: false,
        hasGap: false,
        low: false,
      };
    }
    if (tab === 'photos') {
      return {
        count: payload.photos.length,
        needsAnswer: false,
        hasGap: false,
        low: false,
      };
    }
    if (tab === 'signoff') {
      return {
        count: payload.signatures.length,
        needsAnswer: false,
        hasGap: false,
        low: false,
      };
    }
    const section = SECTIONS.find((s) => s.group === tab);
    const items = (payload[tab] as Item[]) ?? [];
    const sectionKey = Object.entries(REQUIRED_GROUP).find(([, group]) => group === tab)?.[0] as
      | SectionKey
      | undefined;
      return {
        count: items.length,
        needsAnswer: sectionKey ? unansweredSet.has(sectionKey) : false,
        hasGap: gapGroups.has(tab) || warningTabs.has(tab),
        low: section ? items.some((item) => item.confidence === 'low') : false,
      };
  }

  return (
    <main className="app-shell review-shell">
      <section className="sheet review-sheet">
        <header className="review-hero">
          <div>
            <p className="label"><BrandMark size={18} /> {props.projectName}</p>
            <h1 className="page-title">Review diary</h1>
            <p className="mono page-subtitle">
              {props.projectCode} · {props.entryDate}
            </p>
          </div>
          <div className="review-state" aria-label="Review status">
            <strong>{gaps.length}</strong>
            <span>signing gaps</span>
          </div>
        </header>
        <p className="review-intro">
          {props.hasStored
            ? 'Your saved entry. Change anything that is not right.'
            : props.hasProposal
              ? 'Taken from your capture. Nothing here is on the record until you sign it.'
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
        <section className="review-transcript">
          <button
            type="button"
            className="quotebtn"
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript ? 'Hide transcript' : 'Show full transcript'}
          </button>
          {showTranscript && <blockquote className="quote">{props.transcript}</blockquote>}
        </section>
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

      {qualityWarnings.length > 0 && (
        <section className="quality-panel">
          <div>
            <p className="label">Quality check</p>
            <p>{qualityWarnings.length} warning{qualityWarnings.length === 1 ? '' : 's'} before signing.</p>
          </div>
          <ul className="gaplist">
            {qualityWarnings.map((warning) => (
              <li key={warning}>{WARNING_PROMPTS[warning] ?? warning}</li>
            ))}
          </ul>
        </section>
      )}

      <nav className="review-tabs" aria-label="Review sections">
        {REVIEW_TABS.map((tab) => {
          const meta = tabMeta(tab.key);
          const attention = meta.hasGap || meta.needsAnswer || meta.low;
          return (
            <button
              key={tab.key}
              type="button"
              className={`review-tab${activeTab === tab.key ? ' is-active' : ''}${
                attention ? ' review-tab--attention' : ''
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span>{tab.label}</span>
              <span className="review-tab__count mono">{meta.count}</span>
            </button>
          );
        })}
      </nav>

      <section className="review-panel">
        {activeSection && (
          <DocketSection
            section={activeSection}
            reasons={activeReasons}
            items={payload[activeSection.group] as Item[]}
            projectId={props.projectId}
            entryId={props.entryId}
            entryDate={props.entryDate}
            onChange={update}
            onPatch={patchItem}
            onAdd={addItem}
            onBulkAdd={bulkAdd}
            onRemove={removeItem}
          />
        )}

        {activeTab === 'signoff' && (
          <SignaturesBlock
            projectId={props.projectId}
            entryId={props.entryId}
            signatures={payload.signatures}
            onChange={(signatures) => setPayload((prev) => ({ ...prev, signatures }))}
          />
        )}

        {activeTab === 'weather' && (
          <WeatherBlock
            weather={props.weather}
            reading={payload.weather}
            impact={payload.weather_impact}
            onReadingChange={(weather) => setPayload((prev) => ({ ...prev, weather }))}
            onChange={(value) => setPayload((prev) => ({ ...prev, weather_impact: value }))}
          />
        )}

        {activeTab === 'photos' && (
          <PhotosBlock
            photos={payload.photos}
            projectId={props.projectId}
            entryId={props.entryId}
            onChange={(photos) => setPayload((prev) => ({ ...prev, photos }))}
          />
        )}

        {activeTab === 'notes' && (
          <section>
            <div className="review-section-head">
              <div>
                <p className="label">Additional notes</p>
                <h2>Notes</h2>
              </div>
            </div>
            <p className="review-muted">
              Anything worth recording that fits no section above. Part of the signed record.
            </p>
            <label className="fieldcell">
              <textarea
                className="field field--sm"
                rows={5}
                value={payload.notes ?? ''}
                placeholder="Toolbox talk held. Concrete booked for Thursday."
                onChange={(e) =>
                  setPayload((prev) => ({
                    ...prev,
                    notes: e.target.value === '' ? null : e.target.value,
                  }))
                }
              />
            </label>
          </section>
        )}
      </section>

      {unanswered.length > 0 && (
        <section className="review-unanswered">
          <p className="label">Still to answer</p>
          {unanswered.map((key) => (
            <div key={key} className="notice gap review-question">
              <p style={{ margin: 0 }}>{SECTION_QUESTIONS[key]}</p>
              <button
                type="button"
                className="button button--quiet"
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
        </section>
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
      </section>
    </main>
  );
}

function PhotosBlock({
  photos,
  projectId,
  entryId,
  onChange,
}: {
  photos: ReviewPhoto[];
  projectId: string;
  entryId: string;
  onChange: (photos: ReviewPhoto[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const photoUrls = useSignedUrls(photos.map((photo) => photo.url));

  async function upload(files: File[]) {
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createClient();
      const added: ReviewPhoto[] = [];
      for (const file of files) {
        const photo = await compressPhoto(file);
        const path = `${projectId}/${entryId}/${crypto.randomUUID()}.${photo.extension}`;
        const { error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photo.blob, { contentType: photo.contentType, upsert: false });
        if (error) throw new Error(error.message);
        added.push({
          url: path,
          caption: null,
          category: 'progress',
          // A photo picked from the gallery was taken when the file says it
          // was, not when it was attached — the gap between the two can be
          // a whole shift, and the record cares which end of it is true.
          taken_at: new Date(file.lastModified || Date.now()).toISOString(),
          lat: null,
          lng: null,
        });
      }
      onChange([...photos, ...added]);
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

  function patch(index: number, patch: Partial<ReviewPhoto>) {
    onChange(photos.map((photo, i) => (i === index ? { ...photo, ...patch } : photo)));
  }

  return (
    <section>
      <div className="review-section-head">
        <div>
          <p className="label">Site photos {photos.length > 0 && <span className="mono">· {photos.length}</span>}</p>
          <h2>Daily progress photos</h2>
        </div>
        <div className="photo-add-pair">
          <label className="button button--quiet review-add">
            {uploading ? 'Uploading…' : 'Take photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload([file]);
                event.target.value = '';
              }}
            />
          </label>
          <label className="button button--quiet review-add">
            {uploading ? 'Uploading…' : 'From phone'}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={uploading}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) void upload(files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {uploadError && <p className="alert">{uploadError}</p>}
      {photos.length === 0 && <p className="review-empty">No daily progress photos attached.</p>}

      {photos.length > 0 && (
        <div className="photo-review-grid">
          {photos.map((photo, index) => (
            <PhotoCard
              key={photo.url}
              photo={photo}
              index={index}
              src={photoUrls[photo.url] ?? null}
              onPatch={(change) => patch(index, change)}
              onRemove={() => onChange(photos.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoCard({
  photo,
  index,
  src,
  onPatch,
  onRemove,
}: {
  photo: ReviewPhoto;
  index: number;
  src: string | null;
  onPatch: (patch: Partial<ReviewPhoto>) => void;
  onRemove: () => void;
}) {
  return (
    <article className="photo-card">
      <div className="photo-card__image">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={photo.caption ?? `Site photo ${index + 1}`} />
        ) : (
          <span className="mono">Photo {index + 1}</span>
        )}
      </div>

      <div className="photo-card__body">
        <div className="itemhead">
          <div>
            <p className="label">Photo {index + 1}</p>
            <h3>{PHOTO_LABELS[(photo.category ?? 'general') as PhotoCategory]}</h3>
          </div>
          <button type="button" className="quotebtn quotebtn--remove" onClick={onRemove}>
            Remove
          </button>
        </div>

        <label className="fieldcell">
          <span className="label">Section</span>
          <select
            className="field field--sm"
            value={photo.category ?? 'general'}
            onChange={(event) => onPatch({ category: event.target.value as PhotoCategory })}
          >
            {PHOTO_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {PHOTO_LABELS[category]}
              </option>
            ))}
          </select>
        </label>

        <label className="fieldcell" style={{ marginTop: '0.65rem' }}>
          <span className="label">Caption</span>
          <textarea
            className="field field--sm"
            rows={2}
            value={photo.caption ?? ''}
            placeholder="Area, detail, or reason this matters."
            onChange={(event) => onPatch({ caption: event.target.value === '' ? null : event.target.value })}
          />
        </label>
      </div>
    </article>
  );
}

function DocketSection({
  section,
  reasons,
  items,
  projectId,
  entryId,
  entryDate,
  onChange,
  onPatch,
  onAdd,
  onBulkAdd,
  onRemove,
}: {
  section: SectionDef;
  reasons: string[];
  items: Item[];
  projectId: string;
  entryId: string;
  entryDate: string;
  onChange: (group: ItemGroup, index: number, key: string, value: unknown) => void;
  onPatch: (group: ItemGroup, index: number, patch: Item) => void;
  onAdd: (section: SectionDef) => void;
  onBulkAdd: (group: ItemGroup, items: Item[]) => void;
  onRemove: (group: ItemGroup, index: number) => void;
}) {
  return (
    <section>
      <div className="review-section-head">
        <div>
          <p className="label">
            {section.title} {items.length > 0 && <span className="mono">· {items.length}</span>}
          </p>
          <h2>{section.title}</h2>
        </div>
        <button type="button" className="button button--quiet review-add" onClick={() => onAdd(section)}>
          Add {section.noun}
        </button>
      </div>

      {section.group === 'labour' && (
        <CrewShortcuts
          projectId={projectId}
          entryId={entryId}
          entryDate={entryDate}
          existingNames={items.map((item) => String(item.person_name ?? ''))}
          onBulkAdd={onBulkAdd}
        />
      )}

      {reasons.map((reason) => (
        <p key={reason} className="notice gap">
          {reason}
        </p>
      ))}

      {items.length === 0 && (
        <p className="review-empty">
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
    </section>
  );
}

/**
 * Worked hours from the clock: span minus break, rolling past midnight when
 * the finish reads earlier. Mirrors the computation apply_entry_review does
 * at save time, so what the supervisor sees is what the record stores.
 */
function workedHours(
  start: string | null | undefined,
  finish: string | null | undefined,
  breakMins: number | null | undefined,
): number | null {
  if (!start || !finish) return null;
  const parse = (value: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = parse(start);
  const to = parse(finish);
  if (from == null || to == null) return null;
  let span = to - from;
  if (span <= 0) span += 24 * 60;
  const net = (span - (breakMins ?? 0)) / 60;
  return net > 0 ? Math.round(net * 100) / 100 : null;
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
  const heading = String(item[section.identity] ?? '').trim() || `${section.noun} ${index + 1}`;

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
      <header className="itemhead">
        <div>
          <p className="label">{section.noun} {index + 1}</p>
          <h3>{heading}</h3>
        </div>
        <button
          type="button"
          className="quotebtn quotebtn--remove"
          onClick={() => onRemove(section.group, index)}
        >
          Remove
        </button>
      </header>

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
              if (
                section.group === 'labour' &&
                (field.key === 'start_time' || field.key === 'finish_time' || field.key === 'break_mins')
              ) {
                const next = { ...item, [field.key]: value } as {
                  start_time?: string | null;
                  finish_time?: string | null;
                  break_mins?: number | null;
                };
                const computed = workedHours(next.start_time, next.finish_time, next.break_mins);
                if (computed != null) onPatch(section.group, index, { hours: computed });
              }
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
        <select
          {...common}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : field.numeric
                  ? Number(e.target.value)
                  : e.target.value,
            )
          }
        >
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
  const signedUrls = useSignedUrls(isPhotos ? value : []);

  async function upload(files: File[]) {
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createClient();
      const added: string[] = [];
      for (const file of files) {
        const photo = await compressPhoto(file);
        const path = `${projectId}/${entryId}/${crypto.randomUUID()}.${photo.extension}`;
        const { error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photo.blob, { contentType: photo.contentType, upsert: false });
        if (error) throw new Error(error.message);
        added.push(path);
      }
      onChange([...value, ...added]);
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

      {!isPhotos && value.length > 0 && (
        <ul className="chips" style={{ marginBottom: '0.5rem' }}>
          {value.map((entry) => (
            <li key={entry} className="chip chip--on">
              {entry}
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
          {value.length > 0 && (
            <div className="inline-photo-grid">
              {value.map((path, index) => (
                <figure key={path} className="inline-photo">
                  <div className="inline-photo__image">
                    {signedUrls[path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={signedUrls[path]} alt={`${field.label} ${index + 1}`} />
                    ) : (
                      <span className="mono">Photo {index + 1}</span>
                    )}
                  </div>
                  <figcaption>
                    <span className="mono">{path.split('/').pop()?.slice(0, 12) ?? `Photo ${index + 1}`}</span>
                    <button
                      type="button"
                      className="quotebtn quotebtn--remove"
                      onClick={() => onChange(value.filter((v) => v !== path))}
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="photo-add-pair">
            <label className="button button--quiet" style={{ marginTop: 0 }}>
              {uploading ? 'Uploading…' : 'Take photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload([file]);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="button button--quiet" style={{ marginTop: 0 }}>
              {uploading ? 'Uploading…' : 'From phone'}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void upload(files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
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
  reading,
  impact,
  onReadingChange,
  onChange,
}: {
  weather: ReviewWeather | null;
  reading: ReviewWeatherReading;
  impact: string | null;
  onReadingChange: (value: ReviewWeatherReading) => void;
  onChange: (value: string | null) => void;
}) {
  const n = (value: number | null, unit: string, digits = 1) =>
    value == null ? '—' : `${value.toFixed(digits)}${unit}`;
  const hasStation = Boolean(weather?.station_name);

  function numberValue(value: number | null | undefined): string {
    return value == null ? '' : String(value);
  }

  function patch(patch: Partial<ReviewWeatherReading>) {
    onReadingChange({ ...reading, ...patch });
  }

  // One blank-vs-NaN rule for every numeric weather field — the schema test
  // "manual weather readings keep blanks as null" pins these semantics, and
  // four hand-rolled copies of them had already started to accumulate.
  const numberChange =
    (key: 'temp_min' | 'temp_max' | 'rainfall_mm' | 'wind_kmh') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const parsed = Number(raw);
      patch({ [key]: raw === '' || !Number.isFinite(parsed) ? null : parsed });
    };

  return (
    <section>
      <div className="review-section-head">
        <div>
          <p className="label">Weather</p>
          <h2>Weather</h2>
        </div>
      </div>

      <p className="mono" style={{ margin: '0.5rem 0 0' }}>
        {reading
          ? `${n(reading.temp_min, '°')} / ${n(reading.temp_max, '°')} · ${n(
              reading.rainfall_mm,
              ' mm',
            )} · ${reading.wind_dir ?? '—'} ${n(reading.wind_kmh, ' km/h', 0)}`
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
        {hasStation
          ? 'Readings came from the Bureau of Meteorology. Change them only when the site reading is better.'
          : 'No Bureau reading is attached. Enter the site reading if you have one.'}
      </p>

      <div className="fieldgrid" style={{ marginBottom: '0.75rem' }}>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Minimum temp (°C)</span>
          <input
            className="field field--sm"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={numberValue(reading.temp_min)}
            onChange={numberChange('temp_min')}
          />
        </label>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Maximum temp (°C)</span>
          <input
            className="field field--sm"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={numberValue(reading.temp_max)}
            onChange={numberChange('temp_max')}
          />
        </label>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Rainfall (mm)</span>
          <input
            className="field field--sm"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={numberValue(reading.rainfall_mm)}
            onChange={numberChange('rainfall_mm')}
          />
        </label>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Wind direction</span>
          <input
            className="field field--sm"
            value={reading.wind_dir ?? ''}
            placeholder="SW"
            onChange={(event) =>
              patch({ wind_dir: event.target.value.trim() === '' ? null : event.target.value })
            }
          />
        </label>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Wind (km/h)</span>
          <input
            className="field field--sm"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={numberValue(reading.wind_kmh)}
            onChange={numberChange('wind_kmh')}
          />
        </label>
      </div>

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

/**
 * The fastest way to fill a normal day: yesterday's crew and plant in one
 * tap, and chips for the people this project already knows. Everything added
 * this way is "Added by hand" — no source quote, no confidence — because it
 * came from the supervisor's thumb, not the recording.
 */
function CrewShortcuts({
  projectId,
  entryId,
  entryDate,
  existingNames,
  onBulkAdd,
}: {
  projectId: string;
  entryId: string;
  entryDate: string;
  existingNames: string[];
  onBulkAdd: (group: ItemGroup, items: Item[]) => void;
}) {
  const [last, setLast] = useState<null | {
    entryNo: string;
    date: string;
    labour: Item[];
    plant: Item[];
  }>(null);
  const [crew, setCrew] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const [{ data: prev }, { data: keywords }] = await Promise.all([
        supabase
          .from('entries')
          .select('id, entry_no, entry_date')
          .eq('project_id', projectId)
          .eq('status', 'signed')
          .lt('entry_date', entryDate)
          .order('entry_date', { ascending: false })
          .order('signed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('project_keywords')
          .select('term')
          .eq('project_id', projectId)
          .eq('category', 'person')
          .limit(30),
      ]);
      if (cancelled) return;

      const names = new Set((keywords ?? []).map((k) => String(k.term)));
      if (prev) {
        const [{ data: labour }, { data: plant }] = await Promise.all([
          supabase
            .from('labour')
            .select('person_name, role, area, hours, overtime_hours')
            .eq('entry_id', prev.id),
          supabase
            .from('plant')
            .select('item, hire_type, hours, idle_hours, supplier')
            .eq('entry_id', prev.id),
        ]);
        if (cancelled) return;
        for (const row of labour ?? []) names.add(String(row.person_name));
        setLast({
          entryNo: String(prev.entry_no),
          date: String(prev.entry_date),
          labour: (labour ?? []) as Item[],
          plant: (plant ?? []) as Item[],
        });
      }
      setCrew([...names].sort());
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, entryId, entryDate]);

  const have = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const chips = crew.filter((name) => !have.has(name.trim().toLowerCase()));

  const byHand = { source_quote: null, confidence: null };

  function copyLast() {
    if (!last) return;
    onBulkAdd(
      'labour',
      last.labour
        .filter((row) => !have.has(String(row.person_name ?? '').trim().toLowerCase()))
        .map((row) => ({ ...row, ...byHand })),
    );
    onBulkAdd('plant', last.plant.map((row) => ({ ...row, ...byHand })));
    setCopied(true);
  }

  if (!last && chips.length === 0) return null;

  return (
    <div className="crew-shortcuts">
      {last && !copied && existingNames.filter(Boolean).length === 0 && (
        <button type="button" className="button button--quiet" onClick={copyLast}>
          Same crew &amp; plant as {last.date} ({last.labour.length}{' '}
          {last.labour.length === 1 ? 'person' : 'people'}
          {last.plant.length > 0 ? `, ${last.plant.length} plant` : ''})
        </button>
      )}
      {chips.length > 0 && (
        <ul className="chips crew-chips">
          {chips.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onBulkAdd('labour', [
                    {
                      person_name: name,
                      role: null,
                      area: null,
                      // The site's standard day; the supervisor corrects the
                      // exceptions rather than typing the rule every time.
                      hours: 8,
                      overtime_hours: null,
                      ...byHand,
                    },
                  ])
                }
              >
                + {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/**
 * The sign-off tab: the supervisor's mark and the client's, drawn on the
 * phone before the database issues the formal signature. Both are optional —
 * a client is not always on site — and each saved mark is an image in the
 * entry's own storage path, frozen with everything else at signing.
 */
function SignaturesBlock({
  projectId,
  entryId,
  signatures,
  onChange,
}: {
  projectId: string;
  entryId: string;
  signatures: ReviewSignature[];
  onChange: (signatures: ReviewSignature[]) => void;
}) {
  const urls = useSignedUrls(signatures.map((s) => s.image_path));

  return (
    <section>
      <div className="review-section-head">
        <div>
          <p className="label">Sign-off</p>
          <h2>Sign-off</h2>
        </div>
      </div>
      <p style={{ margin: '0.25rem 0 1rem', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
        Sign with a finger. Both marks print on the docket beside the entry&apos;s serial and
        hash. The client&apos;s is optional — capture it when they are on site.
      </p>
      {(['supervisor', 'client'] as const).map((role) => (
        <SignatureSlot
          key={role}
          role={role}
          projectId={projectId}
          entryId={entryId}
          existing={signatures.find((s) => s.role === role) ?? null}
          existingUrl={
            urls[signatures.find((s) => s.role === role)?.image_path ?? ''] ?? null
          }
          onSaved={(signature) =>
            onChange([...signatures.filter((s) => s.role !== role), signature])
          }
          onRemoved={() => onChange(signatures.filter((s) => s.role !== role))}
        />
      ))}
    </section>
  );
}

function SignatureSlot({
  role,
  projectId,
  entryId,
  existing,
  existingUrl,
  onSaved,
  onRemoved,
}: {
  role: 'supervisor' | 'client';
  projectId: string;
  entryId: string;
  existing: ReviewSignature | null;
  existingUrl: string | null;
  onSaved: (signature: ReviewSignature) => void;
  onRemoved: () => void;
}) {
  const [name, setName] = useState(existing?.signatory_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(blob: Blob) {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Put the signatory’s name in first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `${projectId}/${entryId}/signature-${role}-${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: 'image/png', upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      onSaved({ role, signatory_name: trimmed, image_path: path });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The signature did not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="item sigslot">
      <p className="label">{role === 'supervisor' ? 'Supervisor' : 'Client / principal'}</p>
      {existing && existingUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sigslot__image" src={existingUrl} alt={`${existing.signatory_name} signature`} />
          <p style={{ margin: '0.25rem 0 0.5rem' }}>{existing.signatory_name}</p>
          <button type="button" className="quotebtn quotebtn--remove" onClick={onRemoved}>
            Remove and redo
          </button>
        </>
      ) : (
        <>
          <label className="fieldcell">
            <span className="label">Name</span>
            <input
              className="field field--sm"
              value={name}
              placeholder={role === 'supervisor' ? 'Matty' : 'J. Smith — Lendlease'}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <SignaturePad saving={saving} onSave={save} />
          {error && <p className="alert">{error}</p>}
        </>
      )}
    </article>
  );
}
