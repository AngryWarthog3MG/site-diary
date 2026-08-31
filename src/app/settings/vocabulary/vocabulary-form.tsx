'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { KeywordCategory } from '@/types/database';

export interface KeywordRow {
  id: string;
  term: string;
  category: KeywordCategory;
}

const CATEGORIES: KeywordCategory[] = ['person', 'plant', 'area', 'supplier', 'other'];
const CATEGORY_TEXT: Record<KeywordCategory, string> = {
  person: 'Crew names and regular subcontractors',
  plant: 'Machines, trucks and equipment',
  area: 'Site areas, drawing zones and local shorthand',
  supplier: 'Suppliers, subcontractors and brands',
  other: 'Anything else the diary should recognise',
};

export function VocabularyForm({
  projectId,
  canEdit,
  keywords,
}: {
  projectId: string;
  canEdit: boolean;
  keywords: KeywordRow[];
}) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<KeywordCategory>('person');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grouped = useMemo(
    () =>
      CATEGORIES.map((name) => ({
        name,
        rows: keywords.filter((keyword) => keyword.category === name),
      })),
    [keywords],
  );

  async function addKeyword() {
    const clean = term.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      setError('Use at least two characters.');
      return;
    }
    if (clean.length > 60) {
      setError('Keep each term under 60 characters.');
      return;
    }

    setBusy('add');
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      const { error: insertError } = await supabase
        .from('project_keywords')
        .insert({ project_id: projectId, term: clean, category });
      if (insertError) throw new Error(insertError.message);
      setTerm('');
      setNotice(`${clean} added.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That term did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function updateCategory(keyword: KeywordRow, next: KeywordCategory) {
    setBusy(`category:${keyword.id}`);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      const { error: updateError } = await supabase
        .from('project_keywords')
        .update({ category: next })
        .eq('id', keyword.id);
      if (updateError) throw new Error(updateError.message);
      setNotice(`${keyword.term} moved to ${next}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function removeKeyword(keyword: KeywordRow) {
    setBusy(`remove:${keyword.id}`);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      const { error: deleteError } = await supabase
        .from('project_keywords')
        .delete()
        .eq('id', keyword.id);
      if (deleteError) throw new Error(deleteError.message);
      setNotice(`${keyword.term} removed.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That term was not removed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {!canEdit && (
        <p className="notice">
          You can see the project vocabulary. Supervisors and admins can change it.
        </p>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      {canEdit && (
        <>
          <p className="label">Add term</p>
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Word or phrase</span>
            <input
              className="field field--sm"
              value={term}
              maxLength={60}
              autoCapitalize="words"
              placeholder="e.g. Maddington compound, Boral, Jimmy D"
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Category</span>
            <select
              className="field field--sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as KeywordCategory)}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="fieldhint">{CATEGORY_TEXT[category]}</span>
          </label>
          <button
            className="button"
            type="button"
            disabled={busy !== null || term.trim().length < 2}
            onClick={() => void addKeyword()}
          >
            {busy === 'add' ? 'Adding...' : 'Add to vocabulary'}
          </button>

          <hr className="rule" />
        </>
      )}

      <p className="label">Current vocabulary</p>
      {keywords.length === 0 ? (
        <p className="notice">No project vocabulary yet.</p>
      ) : (
        <div className="vocab-list">
          {grouped.map((group) => (
            <section key={group.name} className="vocab-group">
              <div className="vocab-group__head">
                <div>
                  <p className="label">{group.name}</p>
                  <p>{CATEGORY_TEXT[group.name]}</p>
                </div>
                <span className="mono">{group.rows.length}</span>
              </div>

              {group.rows.length === 0 ? (
                <p className="vocab-empty">No terms.</p>
              ) : (
                group.rows.map((keyword) => (
                  <article key={keyword.id} className="vocab-row">
                    <div>
                      <p>{keyword.term}</p>
                      <p className="mono">{keyword.category}</p>
                    </div>

                    {canEdit && (
                      <div className="vocab-row__actions">
                        <select
                          className="field field--sm"
                          value={keyword.category}
                          disabled={busy !== null}
                          onChange={(event) =>
                            void updateCategory(keyword, event.target.value as KeywordCategory)
                          }
                        >
                          {CATEGORIES.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="quotebtn quotebtn--remove"
                          disabled={busy !== null}
                          onClick={() => void removeKeyword(keyword)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </article>
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
