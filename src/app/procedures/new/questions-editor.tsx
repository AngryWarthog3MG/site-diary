'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { QuestionFacts } from '@/lib/documents-control/model';

export interface DraftQuestion { prompt: string; options: string[]; correct: number }

const PASS_MARKS = [100, 80, 70, 50];

/** Writes a draft's questions. The version must still be a draft — the database refuses otherwise. */
export async function saveQuestions(supabase: SupabaseClient, versionId: string, questions: DraftQuestion[]): Promise<void> {
  const rows = questions.map((q, i) => ({ version_id: versionId, position: i + 1, prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()).filter(Boolean), correct_index: q.correct }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('document_questions').insert(rows);
  if (error) throw new Error(`The questions did not save: ${error.message}`);
}

type Props =
  | { draft: DraftQuestion[]; onChange: (q: DraftQuestion[]) => void; passMark: number; onPassMark: (v: number) => void; versionId?: undefined }
  | { versionId: string; initial: QuestionFacts[]; passMark: number | null; draft?: undefined };

/**
 * The comprehension check's questions (README R120). In the issue form they
 * are held until the version exists; on a draft that already exists they are
 * written straight to it. An issued version's questions are frozen, so this
 * never appears for one.
 */
export function QuestionsEditor(props: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState<DraftQuestion>({ prompt: '', options: ['', ''], correct: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list: Array<{ key: string; prompt: string; options: string[]; correct: number | null }> = props.draft
    ? props.draft.map((q, i) => ({ key: String(i), prompt: q.prompt, options: q.options, correct: q.correct }))
    : props.initial.map((q) => ({ key: q.id, prompt: q.prompt, options: q.options, correct: null }));

  const valid = adding.prompt.trim() && adding.options.filter((o) => o.trim()).length >= 2 && adding.options[adding.correct]?.trim();

  async function add() {
    if (!valid) { setError('A question needs its wording, at least two answers, and the right one marked.'); return; }
    setError(null);
    const clean: DraftQuestion = { prompt: adding.prompt.trim(), options: adding.options.map((o) => o.trim()).filter(Boolean), correct: adding.options.filter((o, i) => o.trim() && i < adding.correct).length };
    if (props.draft) { props.onChange([...props.draft, clean]); }
    else {
      setBusy(true);
      try {
        const position = props.initial.length + 1;
        const { error: e } = await createClient().from('document_questions').insert({ version_id: props.versionId, position, prompt: clean.prompt, options: clean.options, correct_index: clean.correct });
        if (e) throw new Error(e.message);
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); } finally { setBusy(false); }
    }
    setAdding({ prompt: '', options: ['', ''], correct: 0 });
  }

  async function remove(key: string) {
    if (props.draft) { props.onChange(props.draft.filter((_, i) => String(i) !== key)); return; }
    setBusy(true); setError(null);
    try {
      const { error: e } = await createClient().from('document_questions').delete().eq('id', key);
      if (e) throw new Error(e.message);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); } finally { setBusy(false); }
  }

  return (
    <div className="docs__questions">
      {list.length > 0 && (
        <ol className="docs__qlist">
          {list.map((q) => (
            <li key={q.key}>
              <span><b>{q.prompt}</b><br /><span className="caption">{q.options.map((o, i) => (q.correct === i ? `✓ ${o}` : o)).join(' · ')}</span></span>
              <button type="button" className="linklike" disabled={busy} onClick={() => void remove(q.key)}>Remove</button>
            </li>
          ))}
        </ol>
      )}
      {props.draft && (
        <label className="fieldcell regs__field" style={{ maxWidth: '14rem' }}><span className="label">Pass mark</span>
          <select className="field field--sm" value={String(props.passMark)} onChange={(e) => props.onPassMark(Number(e.target.value))}>{PASS_MARKS.map((m) => <option key={m} value={m}>{m}%</option>)}</select></label>
      )}
      {!props.draft && <p className="caption">Pass mark {props.passMark ?? 100}% — set on the document when it is issued.</p>}
      <div className="docs__addq">
        <label className="fieldcell regs__field regs__field--wide"><span className="label">Question {list.length + 1}</span><input className="field field--sm" value={adding.prompt} placeholder="When must you tell the supervisor you are unfit for work?" onChange={(e) => setAdding({ ...adding, prompt: e.target.value })} /></label>
        {adding.options.map((o, i) => (
          <label key={i} className="docs__opt">
            <input type="radio" name="correct-new" checked={adding.correct === i} onChange={() => setAdding({ ...adding, correct: i })} aria-label={`Answer ${i + 1} is the right one`} />
            <input className="field field--sm" value={o} placeholder={`Answer ${i + 1}${adding.correct === i ? ' (the right one)' : ''}`} onChange={(e) => setAdding({ ...adding, options: adding.options.map((x, j) => (j === i ? e.target.value : x)) })} />
          </label>
        ))}
        <div className="regs__actions" style={{ marginTop: '.4rem' }}>
          {adding.options.length < 6 && <button type="button" className="linklike" onClick={() => setAdding({ ...adding, options: [...adding.options, ''] })}>Another answer</button>}
          <button type="button" className="button button--quiet" disabled={busy || !valid} onClick={() => void add()}>Add the question</button>
        </div>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
