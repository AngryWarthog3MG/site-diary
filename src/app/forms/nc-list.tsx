'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { NC_STATUS_LABEL, type NcStatus } from '@/lib/forms/model';
import { PRIORITY_LABEL, type ActionPriority } from '@/lib/actions/model';

export interface NcView {
  id: string; submission_id: string; question_label: string; answer: string | null; note: string | null; photo_count: number;
  status: NcStatus; resolution: string | null; resolved_at: string | null; resolver: string | null; removed_reason: string | null;
  raised_as_action: boolean; action: string | null; priority: ActionPriority; owner_name: string | null; assignee: string | null; due_on: string | null; created_at: string;
  form: { code: string; title: string; completed_at: string | null; subject_person: string | null } | null;
}
interface Props { projectId: string; rows: NcView[]; canAct: boolean; isOffice: boolean; today: string; showForm?: boolean }

/**
 * The non-compliance register's rows (README R180): every failing answer, resolved with a note by the site, raised
 * as an action by hand, or removed with a reason by the office. Each change goes through the outbox.
 */
export function NcList({ projectId, rows, canAct, isOffice, today, showForm = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, 'resolve' | 'raise' | 'remove' | undefined>>({});

  const change = (nc: NcView, patch: Record<string, unknown>) => async () => {
    setBusy(nc.id); setError(null);
    try {
      const live = async () => {
        const { data, error: e } = await createClient().from('form_non_compliances').update(patch).eq('id', nc.id).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Not allowed from this account.');
      };
      const queue = () => outbox.enqueue({ kind: 'form_nc_update', projectId, subjectId: nc.submission_id, payload: { ncId: nc.id, patch } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setMode({ ...mode, [nc.id]: undefined }); setText({ ...text, [nc.id]: '' });
      if (outcome !== 'queued') router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  };

  if (rows.length === 0) return <p className="nil">None.</p>;
  return (
    <div className="actreg">
      {rows.map((nc) => {
        const late = nc.status === 'open' && nc.raised_as_action && nc.due_on != null && nc.due_on < today;
        const m = mode[nc.id];
        const t = text[nc.id] ?? '';
        return (
          <div key={nc.id} className={`actreg__row${late ? ' actreg__row--late' : ''}${nc.status !== 'open' ? ' actreg__row--done' : ''}`}>
            <div className="actreg__main">
              <p className="actreg__head">
                <strong>{nc.question_label}</strong>
                <span className="caption">{nc.answer ?? '—'}</span>
                {nc.raised_as_action && <span className={`actreg__pri actreg__pri--${nc.priority}`}>{nc.priority === 'normal' ? 'Action' : PRIORITY_LABEL[nc.priority]}</span>}
              </p>
              {showForm && nc.form && (
                <p className="caption"><Link href={`/forms/${nc.submission_id}?project=${projectId}`}>{nc.form.code} · {nc.form.title}</Link>{nc.form.subject_person ? ` · ${nc.form.subject_person}` : ''}{nc.form.completed_at ? ` · ${fmtPerthDate(nc.form.completed_at)}` : ''}</p>
              )}
              {nc.note && <p className="incident__text">{nc.note}</p>}
              <p className="caption">
                {NC_STATUS_LABEL[nc.status]}
                {nc.photo_count > 0 ? ` · ${nc.photo_count} photo${nc.photo_count === 1 ? '' : 's'}` : ''}
                {nc.raised_as_action ? ` · ${nc.action ?? ''}${nc.assignee ? ` → ${nc.assignee}` : nc.owner_name ? ` → ${nc.owner_name}` : ''}${nc.due_on ? ` · due ${fmtDate(nc.due_on)}` : ''}${late ? ' · OVERDUE' : ''}` : ''}
                {nc.status === 'resolved' ? ` · ${fmtPerthDate(nc.resolved_at)}${nc.resolver ? ` by ${nc.resolver}` : ''} — ${nc.resolution ?? ''}` : ''}
                {nc.status === 'removed' ? ` — ${nc.removed_reason ?? ''}` : ''}
              </p>
            </div>
            {nc.status === 'open' && canAct && (
              <div className="signin__actions">
                {!m && <button type="button" className="linklike" disabled={busy != null} onClick={() => setMode({ ...mode, [nc.id]: 'resolve' })}>Resolve</button>}
                {!m && !nc.raised_as_action && <button type="button" className="linklike" disabled={busy != null} onClick={() => setMode({ ...mode, [nc.id]: 'raise' })}>Raise as action</button>}
                {!m && isOffice && <button type="button" className="linklike" disabled={busy != null} onClick={() => setMode({ ...mode, [nc.id]: 'remove' })}>Remove</button>}
              </div>
            )}
            {m && (
              <div className="actreg__edit">
                <input className="field field--sm" value={t} onChange={(e) => setText({ ...text, [nc.id]: e.target.value })}
                  placeholder={m === 'resolve' ? 'How it was resolved' : m === 'raise' ? 'What has to be done' : 'Why it is not a finding'} />
                <div className="photo-add-pair">
                  <button type="button" className="button button--quiet" style={{ marginTop: 0 }} disabled={busy != null || !t.trim()}
                    onClick={() => void change(nc, m === 'resolve' ? { status: 'resolved', resolution: t.trim() } : m === 'raise' ? { raised_as_action: true, action: t.trim() } : { status: 'removed', removed_reason: t.trim() })()}>
                    {busy === nc.id ? 'Saving…' : m === 'resolve' ? 'Resolved' : m === 'raise' ? 'Raise it' : 'Remove it'}
                  </button>
                  <button type="button" className="linklike" onClick={() => setMode({ ...mode, [nc.id]: undefined })}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
