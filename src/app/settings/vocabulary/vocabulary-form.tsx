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

  /**
   * One runner for every mutation: busy key in, one query, success notice,
   * refresh. Three hand-rolled copies of this choreography had already begun
   * to drift; the members form uses the same shape.
   */
  async function request(
    busyKey: string,
    // PromiseLike: a PostgREST query builder is a thenable, not a Promise.
    action: () => PromiseLike<{ error: { message: string } | null }>,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const { error: actionError } = await action();
      if (actionError) throw new Error(actionError.message);
      setNotice(successMessage);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
      return false;
    } finally {
      setBusy(null);
    }
  }

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
    const ok = await request(
      'add',
      () =>
        createClient().from('project_keywords').insert({ project_id: projectId, term: clean, category }),
      `${clean} added.`,
      'That term did not save.',
    );
    if (ok) setTerm('');
  }

  async function updateCategory(keyword: KeywordRow, next: KeywordCategory) {
    await request(
      `category:${keyword.id}`,
      () => createClient().from('project_keywords').update({ category: next }).eq('id', keyword.id),
      `${keyword.term} moved to ${next}.`,
      'That change did not save.',
    );
  }

  async function removeKeyword(keyword: KeywordRow) {
    await request(
      `remove:${keyword.id}`,
      () => createClient().from('project_keywords').delete().eq('id', keyword.id),
      `${keyword.term} removed.`,
      'That term was not removed.',
    );
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
