'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  QUESTION_TYPES, QUESTION_TYPE_LABEL, FAILABLE_TYPES, FORM_CATEGORIES, CATEGORY_LABEL, TEMPLATE_STATUS_LABEL, PROFILES, PROFILE_LABEL,
  SUBJECTS, SUBJECT_LABEL, SIGNATURE_RULES, AUDIENCE_ROLES, templateProblems, specFromLines, keyFor,
  type FormSpec, type Question, type FormCategory, type FormProfile, type FormSubject, type SignatureRule, type QuestionType,
} from '@/lib/forms/model';
import type { TemplateRow } from '@/lib/forms/load';
import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

interface Props { orgId: string; userId: string; templates: TemplateRow[]; selectedId: string | null; projectId: string }
interface Draft {
  id: string | null; supersedesId: string | null; title: string; category: FormCategory; profile: FormProfile; subject: FormSubject;
  audience: string[]; signature: SignatureRule; passMark: string; basis: string; competencyKey: string; spec: FormSpec;
}

const fromRow = (t: TemplateRow, asRevision = false): Draft => ({
  id: asRevision ? null : t.id, supersedesId: asRevision ? t.id : t.supersedes_id, title: t.title, category: t.category, profile: t.profile, subject: t.subject,
  audience: t.audience, signature: t.signature, passMark: t.pass_mark == null ? '' : String(t.pass_mark), basis: t.basis ?? '', competencyKey: t.competency_key ?? '',
  spec: JSON.parse(JSON.stringify(t.spec)) as FormSpec,
});
const blank = (): Draft => ({ id: null, supersedesId: null, title: '', category: 'safety', profile: 'public', subject: 'none', audience: [], signature: 'required', passMark: '', basis: '', competencyKey: '', spec: { header: [], sections: [{ title: 'Checks', questions: [] }] } });

/**
 * The form designer (README R180): sections and questions with their types and rules, the audience, the subject, the
 * pass mark. A draft saves as often as you like; Issue freezes it, after which a change is a new revision. A paper
 * checklist pastes in one line per question and gets its types afterwards.
 */
export function Designer({ orgId, userId, templates, selectedId, projectId }: Props) {
  const router = useRouter();
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Draft | null>(selected ? fromRow(selected) : null);
  const [lines, setLines] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frozen = Boolean(draft?.id && selected && selected.status !== 'draft');
  const q = `?project=${projectId}`;

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label); setError(null);
    try { const to = await fn(); if (to) router.push(to); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const payload = (d: Draft) => ({
    title: d.title.trim(), category: d.category, profile: d.profile, subject: d.subject, audience: d.audience, signature: d.signature,
    pass_mark: d.passMark.trim() === '' ? null : Number(d.passMark), basis: d.basis.trim() || null, competency_key: d.competencyKey.trim() || null, spec: d.spec,
  });
  const save = (thenIssue = false) => run(thenIssue ? 'issue the form' : 'save the draft', async () => {
    if (!draft) return;
    if (!draft.title.trim()) throw new Error('Give the form a title.');
    if (thenIssue) { const problems = templateProblems(draft.spec); if (problems.length) throw new Error(problems.join(' ')); }
    const supabase = createClient();
    let id = draft.id;
    if (id) {
      const { data, error: e } = await supabase.from('form_templates').update(payload(draft)).eq('id', id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    } else {
      const { data, error: e } = await supabase.from('form_templates').insert({ org_id: orgId, created_by: userId, supersedes_id: draft.supersedesId, ...payload(draft) }).select('id').single();
      if (e) throw new Error(e.message);
      id = data.id as string;
    }
    if (thenIssue) {
      const { data, error: e } = await supabase.from('form_templates').update({ status: 'issued' }).eq('id', id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    }
    return `/forms/design${q}&t=${id}`;
  });
  const retire = () => run('retire the form', async () => {
    if (!draft?.id) return;
    const { data, error: e } = await createClient().from('form_templates').update({ status: 'retired' }).eq('id', draft.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const discard = () => run('discard the draft', async () => {
    if (!draft?.id) { setDraft(null); return; }
    const { data, error: e } = await createClient().from('form_templates').delete().eq('id', draft.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Only a draft is discarded.');
    return `/forms/design${q}`;
  });

  const setSpec = (fn: (s: FormSpec) => void) => setDraft((d) => { if (!d) return d; const s = JSON.parse(JSON.stringify(d.spec)) as FormSpec; fn(s); return { ...d, spec: s }; });
  const taken = () => new Set(draft?.spec.sections.flatMap((s) => s.questions.map((qq) => qq.key)) ?? []);
  const addQuestion = (si: number) => setSpec((s) => { const t = taken(); const n = s.sections.reduce((a, x) => a + x.questions.length, 0) + 1; s.sections[si].questions.push({ key: keyFor(`q ${n}`, t, n), label: '', type: 'ok_issue_na' }); });
  const importLines = () => { const parsed = specFromLines(lines); if (parsed.sections.length === 0) return; setSpec((s) => { s.sections = [...s.sections.filter((x) => x.questions.length > 0), ...parsed.sections]; }); setLines(''); };

  const questionRow = (si: number, qi: number, qn: Question) => {
    const up = (patch: Partial<Question>) => setSpec((s) => { s.sections[si].questions[qi] = { ...s.sections[si].questions[qi], ...patch }; });
    const failable = FAILABLE_TYPES.includes(qn.type);
    return (
      <li key={qn.key} className="formdes__q">
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">Question</span>
            <input className="field field--sm" value={qn.label} disabled={frozen} onChange={(e) => { const t = taken(); t.delete(qn.key); up({ label: e.target.value, ...(qn.label === '' || /^q_\d+$/.test(qn.key) ? { key: keyFor(e.target.value, t, qi + 1) } : {}) }); }} /></label>
          <label className="fieldcell fieldcell--narrow"><span className="label">Type</span>
            <select className="field field--sm" value={qn.type} disabled={frozen} onChange={(e) => up({ type: e.target.value as QuestionType })}>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
            </select></label>
        </div>
        <div className="crewchips">
          <label className="chip"><input type="checkbox" checked={Boolean(qn.required)} disabled={frozen} onChange={(e) => up({ required: e.target.checked || undefined })} /> Required</label>
          {failable && <label className="chip"><input type="checkbox" checked={Boolean(qn.raise_action)} disabled={frozen} onChange={(e) => up({ raise_action: e.target.checked || undefined })} /> A fail raises an action</label>}
          {failable && <label className="chip"><input type="checkbox" checked={Boolean(qn.photo_required)} disabled={frozen} onChange={(e) => up({ photo_required: e.target.checked || undefined })} /> Photo on a fail</label>}
          {qn.type === 'yes_no' && <label className="chip">Fails on <select className="field field--sm" value={String(qn.fail ?? 'no')} disabled={frozen} onChange={(e) => up({ fail: e.target.value })}><option value="no">No</option><option value="yes">Yes</option></select></label>}
          {qn.type === 'score' && <label className="chip">Out of <input className="field field--sm formdes__num" type="number" min={1} max={100} value={qn.max ?? 5} disabled={frozen} onChange={(e) => up({ max: Number(e.target.value) || 5 })} /></label>}
          {qn.type === 'score' && <label className="chip">Weight <input className="field field--sm formdes__num" type="number" min={0.1} step="0.1" value={qn.weight ?? 1} disabled={frozen} onChange={(e) => up({ weight: Number(e.target.value) || 1 })} /></label>}
          {qn.type === 'score' && <label className="chip">Fails under <input className="field field--sm formdes__num" type="number" value={qn.fail == null ? '' : String(qn.fail)} disabled={frozen} onChange={(e) => up({ fail: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
          {qn.type === 'number' && <label className="chip">Min <input className="field field--sm formdes__num" type="number" value={qn.min ?? ''} disabled={frozen} onChange={(e) => up({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
          {qn.type === 'number' && <label className="chip">Max <input className="field field--sm formdes__num" type="number" value={qn.max ?? ''} disabled={frozen} onChange={(e) => up({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
          {qn.type === 'number' && <label className="chip">Unit <input className="field field--sm formdes__num" value={qn.unit ?? ''} disabled={frozen} onChange={(e) => up({ unit: e.target.value || undefined })} /></label>}
          {(qn.type === 'select' || qn.type === 'multi') && <label className="chip">Options <input className="field field--sm" placeholder="comma separated" value={(qn.options ?? []).join(', ')} disabled={frozen} onChange={(e) => up({ options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>}
          {(qn.type === 'select' || qn.type === 'multi') && <label className="chip">Failing <input className="field field--sm" placeholder="which options fail" value={(qn.fail_options ?? []).join(', ')} disabled={frozen} onChange={(e) => up({ fail_options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>}
          <label className="chip">Help <input className="field field--sm" value={qn.help ?? ''} placeholder="a line under the question" disabled={frozen} onChange={(e) => up({ help: e.target.value || undefined })} /></label>
          {!frozen && <button type="button" className="linklike" onClick={() => setSpec((s) => { s.sections[si].questions.splice(qi, 1); })}>Remove</button>}
          {!frozen && qi > 0 && <button type="button" className="linklike" onClick={() => setSpec((s) => { const a = s.sections[si].questions; [a[qi - 1], a[qi]] = [a[qi], a[qi - 1]]; })}>Up</button>}
        </div>
      </li>
    );
  };

  return (
    <div className="formdes">
      <section className="item">
        <p className="label">The company&rsquo;s forms</p>
        {templates.length === 0 && <p className="nil">None yet.</p>}
        {templates.map((t) => (
          <div key={t.id} className={`prestart-row${t.status === 'issued' ? ' prestart-row--done' : t.status === 'draft' ? ' prestart-row--open' : ''}`}>
            <span><strong>{t.title}</strong><br /><span className="caption">{t.code} rev {t.revision} · {TEMPLATE_STATUS_LABEL[t.status]} · {CATEGORY_LABEL[t.category]} · {t.spec.sections.reduce((n, s) => n + s.questions.length, 0)} questions{t.audience.length ? ` · ${t.audience.map((r) => ROLE_LABEL[r as MemberRole] ?? r).join(', ')}` : ' · everyone'}</span></span>
            <span className="signin__actions">
              <button type="button" className="linklike" disabled={busy != null} onClick={() => { setDraft(fromRow(t)); router.push(`/forms/design${q}&t=${t.id}`); }}>{t.status === 'draft' ? 'Edit' : 'Open'}</button>
              {t.status === 'issued' && <button type="button" className="linklike" disabled={busy != null} onClick={() => { setDraft(fromRow(t, true)); router.push(`/forms/design${q}`); }}>New revision</button>}
            </span>
          </div>
        ))}
        {!draft && <button type="button" className="button" onClick={() => setDraft(blank())}>New form</button>}
      </section>

      {draft && (
        <section className="item">
          <p className="label">{draft.id ? (frozen ? `${selected?.code} rev ${selected?.revision} — ${TEMPLATE_STATUS_LABEL[selected?.status ?? 'draft']}, frozen` : `Draft ${selected?.code ?? ''}`) : draft.supersedesId ? 'New revision (draft)' : 'New form (draft)'}</p>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Title</span><input className="field field--sm" value={draft.title} disabled={frozen} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Category</span>
              <select className="field field--sm" value={draft.category} disabled={frozen} onChange={(e) => setDraft({ ...draft, category: e.target.value as FormCategory })}>{FORM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell fieldcell--narrow"><span className="label">Profile</span>
              <select className="field field--sm" value={draft.profile} disabled={frozen} onChange={(e) => setDraft({ ...draft, profile: e.target.value as FormProfile })}>{PROFILES.map((c) => <option key={c} value={c}>{PROFILE_LABEL[c]}</option>)}</select></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">About</span>
              <select className="field field--sm" value={draft.subject} disabled={frozen} onChange={(e) => setDraft({ ...draft, subject: e.target.value as FormSubject })}>{SUBJECTS.map((c) => <option key={c} value={c}>{SUBJECT_LABEL[c]}</option>)}</select></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Signature</span>
              <select className="field field--sm" value={draft.signature} disabled={frozen} onChange={(e) => setDraft({ ...draft, signature: e.target.value as SignatureRule })}>{SIGNATURE_RULES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Pass mark %</span><input className="field field--sm" type="number" min={0} max={100} value={draft.passMark} disabled={frozen} onChange={(e) => setDraft({ ...draft, passMark: e.target.value })} /></label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Basis</span><input className="field field--sm" value={draft.basis} placeholder="What requires it — a procedure, a clause" disabled={frozen} onChange={(e) => setDraft({ ...draft, basis: e.target.value })} /></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Ticket on a pass</span><input className="field field--sm" value={draft.competencyKey} placeholder="e.g. excavator" disabled={frozen} onChange={(e) => setDraft({ ...draft, competencyKey: e.target.value })} /></label>
          </div>
          <p className="label">Who fills it</p>
          <div className="crewchips">
            {AUDIENCE_ROLES.map((r) => (
              <label key={r} className={`chip${draft.audience.includes(r) ? ' chip--on' : ''}`}>
                <input type="checkbox" checked={draft.audience.includes(r)} disabled={frozen} onChange={(e) => setDraft({ ...draft, audience: e.target.checked ? [...draft.audience, r] : draft.audience.filter((x) => x !== r) })} /> {ROLE_LABEL[r as MemberRole] ?? r}
              </label>
            ))}
            <span className="caption">{draft.audience.length === 0 ? 'Nobody ticked = every member of the job.' : 'Only these roles. A labourer sees a form only when ticked here.'}</span>
          </div>

          {draft.spec.sections.map((s, si) => (
            <div key={si} className="formdes__section">
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Section {si + 1}</span><input className="field field--sm" value={s.title} disabled={frozen} onChange={(e) => setSpec((x) => { x.sections[si].title = e.target.value; })} /></label>
                {!frozen && <button type="button" className="linklike" onClick={() => setSpec((x) => { x.sections.splice(si, 1); })}>Remove section</button>}
              </div>
              <ul className="plainlist">{s.questions.map((qn, qi) => questionRow(si, qi, qn))}</ul>
              {!frozen && <button type="button" className="linklike" onClick={() => addQuestion(si)}>Add a question</button>}
            </div>
          ))}
          {!frozen && (
            <>
              <button type="button" className="linklike" onClick={() => setSpec((s) => { s.sections.push({ title: `Section ${s.sections.length + 1}`, questions: [] }); })}>Add a section</button>
              <div className="item">
                <p className="label">Paste a paper checklist</p>
                <textarea className="field field--sm" rows={4} value={lines} placeholder={'# Section title\nOne question per line\nAnother question'} onChange={(e) => setLines(e.target.value)} />
                <button type="button" className="linklike" disabled={!lines.trim()} onClick={importLines}>Add these as OK / Issue / N/A questions</button>
              </div>
            </>
          )}
          {!frozen && templateProblems(draft.spec).length > 0 && <p className="caption vr-missing">Before it can issue: {templateProblems(draft.spec).join(' ')}</p>}
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="photo-add-pair">
            {!frozen && <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void save(false)}>{busy === 'save the draft' ? 'Saving…' : 'Save draft'}</button>}
            {!frozen && <button type="button" className="button" disabled={busy != null || templateProblems(draft.spec).length > 0} onClick={() => void save(true)}>{busy === 'issue the form' ? 'Issuing…' : 'Issue'}</button>}
            {!frozen && <button type="button" className="linklike" disabled={busy != null} onClick={() => void discard()}>Discard draft</button>}
            {frozen && selected?.status === 'issued' && <button type="button" className="linklike" disabled={busy != null} onClick={() => void retire()}>Retire</button>}
            <button type="button" className="linklike" onClick={() => { setDraft(null); router.push(`/forms/design${q}`); }}>Close</button>
          </div>
        </section>
      )}
    </div>
  );
}
