'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { Fold } from '@/components/fold';
import {
  actionStatus, originHref, ORIGIN_LABEL, PRIORITY_LABEL, STATUS_LABEL, ACTION_PRIORITIES, ACTION_ORIGINS,
  type ActionOrigin, type ActionPriority, type ActionSummary,
} from '@/lib/actions/model';
import type { ActionRegisterData, RegisterPerson } from '@/lib/actions/load';

type Row = ActionRegisterData['rows'][number];
type View = 'open' | 'mine' | 'overdue';

async function call(method: 'POST' | 'PATCH' | 'DELETE', body: object): Promise<Record<string, unknown>> {
  const res = await fetch('/api/actions', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? 'That did not save.');
  return json as Record<string, unknown>;
}

export function Register({ orgId, projectId, userId, today, canRaise, canRaiseCompany, rows, summary, people }: {
  orgId: string; projectId: string; userId: string; today: string; canRaise: boolean; canRaiseCompany: boolean;
  rows: Row[]; summary: ActionSummary; people: RegisterPerson[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('open');
  const [origin, setOrigin] = useState<ActionOrigin | ''>('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = `?project=${projectId}`;

  const open = rows.filter((r) => r.done_at == null);
  const done = rows.filter((r) => r.done_at != null);
  const shown = open
    .filter((r) => (view === 'mine' ? r.assigned_to === userId : view === 'overdue' ? actionStatus(r, today) === 'overdue' : true))
    .filter((r) => (origin ? r.origin === origin : true));

  const after = (msg: string | null) => { setError(null); setNotice(msg); router.refresh(); };

  return (
    <div className="actreg">
      <div className="chemreg__stats">
        <span className={summary.overdue > 0 ? 'vr-missing' : undefined}><strong className="mono">{summary.overdue}</strong> overdue</span>
        <span><strong className="mono">{summary.dueSoon}</strong> due this week</span>
        <span><strong className="mono">{summary.open}</strong> open</span>
        <span><strong className="mono">{summary.mine}</strong> on you</span>
      </div>

      {canRaise && !adding && (
        <button type="button" className="button" style={{ marginTop: '0.75rem' }} onClick={() => { setAdding(true); setNotice(null); }}>Add an action</button>
      )}
      {adding && (
        <AddForm orgId={orgId} projectId={projectId} canRaiseCompany={canRaiseCompany} people={people}
          onDone={(msg) => { setAdding(false); after(msg); }} onCancel={() => setAdding(false)} />
      )}
      {error && <p className="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="chips chips--compact" style={{ marginTop: '1rem' }}>
        {(['open', 'mine', 'overdue'] as View[]).map((v) => (
          <button key={v} type="button" className={`chip${view === v ? ' chip--on' : ''}`} onClick={() => setView(v)}>
            {v === 'open' ? `All open · ${open.length}` : v === 'mine' ? `On you · ${summary.mine}` : `Overdue · ${summary.overdue}`}
          </button>
        ))}
        <select className="field field--sm" aria-label="From" value={origin} onChange={(e) => setOrigin(e.target.value as ActionOrigin | '')} style={{ width: 'auto' }}>
          <option value="">Every origin</option>
          {ACTION_ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="nil" style={{ marginTop: '1rem' }}>
          {open.length === 0 ? 'Nothing open. Every action on this job is done.' : 'Nothing matches that filter.'}
        </p>
      ) : (
        <div className="chemreg__list" style={{ marginTop: '0.75rem' }}>
          {shown.map((r) => (
            <ActionRow key={`${r.origin}-${r.id}`} r={r} today={today} userId={userId} people={people} q={q}
              onChanged={after} onError={(m) => { setNotice(null); setError(m); }} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <Fold label="Done" count={done.length}>
            <div className="chemreg__list">
              {done.map((r) => <ActionRow key={`${r.origin}-${r.id}`} r={r} today={today} userId={userId} people={people} q={q} onChanged={after} onError={setError} />)}
            </div>
          </Fold>
        </div>
      )}
    </div>
  );
}

function ActionRow({ r, today, userId, people, q, onChanged, onError }: {
  r: Row; today: string; userId: string; people: RegisterPerson[]; q: string; onChanged: (msg: string | null) => void; onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignedTo, setAssignedTo] = useState(r.assigned_to ?? '');
  const [priority, setPriority] = useState<ActionPriority>(r.priority);
  const [dueOn, setDueOn] = useState(r.due_on ?? '');
  const [ownerName, setOwnerName] = useState(r.owner_name ?? '');
  const [note, setNote] = useState('');
  const st = actionStatus(r, today);
  const href = originHref(r, q);
  const fixedWording = r.origin === 'audit' || r.origin === 'review' || r.origin === 'compliance';
  const isDone = r.done_at != null;

  const run = async (what: string, fn: () => Promise<string | null>) => {
    setBusy(true);
    try { onChanged(await fn()); setEditing(false); setClosing(false); }
    catch (e) { onError(e instanceof Error ? e.message : `Could not ${what}.`); }
    finally { setBusy(false); }
  };
  const save = () => run('save', async () => {
    const out = await call('PATCH', { origin: r.origin, id: r.id, assignedTo: assignedTo || null, priority, dueOn: dueOn || null, ownerName: ownerName || null });
    const pushed = Number(out.pushed ?? 0);
    return pushed > 0 ? 'Saved. Their phone has been told.' : 'Saved.';
  });
  const complete = () => run('mark it done', async () => { await call('PATCH', { origin: r.origin, id: r.id, done: true, note }); return 'Marked done.'; });
  const remove = () => run('remove it', async () => { await call('DELETE', { id: r.id }); return 'Removed.'; });

  return (
    <div className={`actreg__row${isDone ? ' actreg__row--done' : st === 'overdue' ? ' actreg__row--late' : st === 'due_soon' ? ' actreg__row--soon' : ''}`}>
      <div className="actreg__main">
        <p className="actreg__head">
          {r.priority !== 'normal' && !isDone && <span className={`actreg__pri actreg__pri--${r.priority}`}>{PRIORITY_LABEL[r.priority]}</span>}
          <strong>{r.action}</strong>
        </p>
        {r.detail && <p className="caption">{r.detail}</p>}
        <p className="caption">
          {href ? <Link href={href}>{r.record_ref ?? ORIGIN_LABEL[r.origin]}</Link> : ORIGIN_LABEL[r.origin]}
          {r.record_title ? ` · ${r.record_title}` : ''}
          {' · '}{r.assignee ? <>for <strong>{r.assignee}</strong></> : r.owner_name ? <>owner {r.owner_name}</> : <span className="vr-missing">nobody assigned</span>}
          {r.due_on ? ` · due ${fmtDate(r.due_on)}` : ' · no date'}
          {' · '}<span className={st === 'overdue' ? 'vr-missing' : undefined}>{STATUS_LABEL[st]}</span>
          {r.raiser ? ` · raised by ${r.raiser} ${fmtPerthDate(r.raised_at)}` : ''}
          {isDone && r.done_at ? ` · done ${fmtPerthDate(r.done_at)}${r.closer ? ` by ${r.closer}` : ''}${r.done_note ? ` — ${r.done_note}` : ''}` : ''}
        </p>
      </div>
      {!isDone && !editing && !closing && (
        <div className="signin__actions">
          <button type="button" className="button button--quiet" disabled={busy} onClick={() => setEditing(true)}>Assign</button>
          <button type="button" className="button button--quiet" disabled={busy} onClick={() => setClosing(true)}>Done</button>
          {r.origin === 'manual' && r.raised_by === userId && (
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { if (window.confirm('Remove this action? It was never done.')) void remove(); }}>Remove</button>
          )}
        </div>
      )}
      {editing && (
        <div className="actreg__edit">
          <label className="fieldcell"><span className="label">Assigned to</span>
            <select className="field field--sm" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.roles.join('/')}</option>)}
            </select></label>
          <label className="fieldcell"><span className="label">Priority</span>
            <select className="field field--sm" value={priority} onChange={(e) => setPriority(e.target.value as ActionPriority)}>
              {ACTION_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select></label>
          {!fixedWording && (
            <>
              <label className="fieldcell"><span className="label">Due</span>
                <input type="date" className="field field--sm" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
              <label className="fieldcell"><span className="label">Owner (name on the sheets, if no login)</span>
                <input className="field field--sm" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></label>
            </>
          )}
          {fixedWording && <p className="caption">An issued {ORIGIN_LABEL[r.origin].toLowerCase()} keeps its wording, owner and due date; who holds it and its priority can move.</p>}
          <div className="signin__actions">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
      {closing && (
        <div className="actreg__edit">
          <label className="fieldcell"><span className="label">How it was done</span>
            <input className="field field--sm" value={note} placeholder="What was done, and when" onChange={(e) => setNote(e.target.value)} /></label>
          <div className="signin__actions">
            <button type="button" className="button" disabled={busy} onClick={() => void complete()}>{busy ? 'Saving…' : 'Mark done'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => setClosing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ orgId, projectId, canRaiseCompany, people, onDone, onCancel }: {
  orgId: string; projectId: string; canRaiseCompany: boolean; people: RegisterPerson[]; onDone: (msg: string | null) => void; onCancel: () => void;
}) {
  const [action, setAction] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState<ActionPriority>('normal');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [scope, setScope] = useState<'job' | 'company'>('job');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function raise() {
    if (!action.trim()) { setError('Say what has to be done.'); return; }
    setBusy(true); setError(null);
    try {
      const out = await call('POST', { orgId, projectId: scope === 'company' ? null : projectId, action, detail, priority, assignedTo: assignedTo || null, dueOn: dueOn || null });
      onDone(Number(out.pushed ?? 0) > 0 ? 'Raised. Their phone has been told.' : 'Raised.');
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="item" style={{ marginTop: '0.75rem' }}>
      <label className="fieldcell" htmlFor="act-what"><span className="label">What has to be done</span>
        <input id="act-what" className="field" value={action} maxLength={500} placeholder="Replace the missing bollard at the north gate" onChange={(e) => setAction(e.target.value)} /></label>
      <label className="fieldcell" htmlFor="act-detail"><span className="label">Detail (optional)</span>
        <textarea id="act-detail" className="field field--sm" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
      <label className="fieldcell" htmlFor="act-who"><span className="label">Assigned to</span>
        <select id="act-who" className="field field--sm" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">Nobody yet</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.roles.join('/')}</option>)}
        </select></label>
      <label className="fieldcell" htmlFor="act-pri"><span className="label">Priority</span>
        <select id="act-pri" className="field field--sm" value={priority} onChange={(e) => setPriority(e.target.value as ActionPriority)}>
          {ACTION_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select></label>
      <label className="fieldcell" htmlFor="act-due"><span className="label">Due</span>
        <input id="act-due" type="date" className="field field--sm" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
      {canRaiseCompany && (
        <label className="fieldcell" htmlFor="act-scope"><span className="label">Where</span>
          <select id="act-scope" className="field field--sm" value={scope} onChange={(e) => setScope(e.target.value as 'job' | 'company')}>
            <option value="job">This job</option>
            <option value="company">The whole company — shows on every job</option>
          </select></label>
      )}
      {error && <p className="alert">{error}</p>}
      <div className="signin__actions">
        <button type="button" className="button" disabled={busy} onClick={() => void raise()}>{busy ? 'Saving…' : 'Raise it'}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
