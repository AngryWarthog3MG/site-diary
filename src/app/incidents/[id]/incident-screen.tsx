'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import {
  KIND_LABEL, STATUS_LABEL, TREATMENT_LABEL, SEVERITY_LABEL, incidentRef, actionOverdue,
  type IncidentKind, type IncidentStatus, type Treatment, type Severity,
} from '@/lib/incidents/model';

export interface IncidentView {
  id: string; projectId: string; seq: number; kind: IncidentKind; status: IncidentStatus;
  occurred_at: string; reported_at: string; reported_on_device_at: string; reported_by_name: string;
  location: string | null; description: string; immediate_actions: string | null;
  people_involved: string[]; witnesses: string[]; injured_name: string | null; injury_type: string | null; body_part: string | null;
  treatment: Treatment | null; actual_severity: Severity | null; potential_severity: Severity | null; notifiable: boolean; plant: string | null;
  photo_urls: string[]; closed_at: string | null; notified_at: string | null;
  updates: Array<{ id: string; kind: string; body: string; photo_urls: string[]; created_at: string; by: string }>;
  actions: Array<{ id: string; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null; created_by: string }>;
}

interface Props { incident: IncidentView; crew: string[]; canReport: boolean; canManage: boolean; userId: string; today: string }

const UPDATE_KINDS: Array<{ key: string; label: string }> = [
  { key: 'note', label: 'Note' }, { key: 'investigation', label: 'Investigation' }, { key: 'root_cause', label: 'Root cause' }, { key: 'regulator', label: 'Regulator contact' },
];

export function IncidentScreen({ incident: r, crew, canReport, canManage, userId, today }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState('note');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [doneNote, setDoneNote] = useState<Record<string, string>>({});
  const closed = r.status === 'closed';
  const openActions = r.actions.filter((a) => a.done_at == null);

  useEffect(() => {
    const paths = [...r.photo_urls, ...r.updates.flatMap((u) => u.photo_urls)];
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('entry-photos').createSignedUrls(paths, 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [r.photo_urls, r.updates]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const addUpdate = () => run('add the update', async () => {
    if (!note.trim()) throw new Error('Write the update first.');
    const { error: e } = await createClient().from('incident_updates').insert({ incident_id: r.id, kind: noteKind, body: note.trim(), created_by: userId });
    if (e) throw new Error(e.message);
    setNote('');
  });
  const addAction = () => run('add the action', async () => {
    if (!action.trim()) throw new Error('Say what has to be done.');
    const { error: e } = await createClient().from('incident_actions').insert({ incident_id: r.id, action: action.trim(), owner_name: owner.trim() || null, due_on: due || null, created_by: userId });
    if (e) throw new Error(e.message);
    setAction(''); setOwner(''); setDue('');
  });
  const markDone = (id: string) => run('mark it done', async () => {
    const { data, error: e } = await createClient().from('incident_actions').update({ done_at: new Date().toISOString(), done_note: (doneNote[id] ?? '').trim() || null }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const removeAction = (id: string) => run('remove the action', async () => {
    const { data, error: e } = await createClient().from('incident_actions').delete().eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account, or already done.');
  });
  const setStatus = (status: IncidentStatus) => run('change the status', async () => {
    if (status === 'closed' && !window.confirm('Close this report? Every action is done and nothing more can be added.')) return;
    const { data, error: e } = await createClient().from('incidents').update({ status }).eq('id', r.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const pdf = () => run('make the PDF', async () => {
    const res = await fetch(`/api/incidents/${r.id}/pdf`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The PDF could not be made.');
    window.open(body.url, '_blank', 'noopener');
  });

  return (
    <section className="incident">
      <p className="label">{incidentRef(r.seq)} · {KIND_LABEL[r.kind]}{r.notifiable ? ' · NOTIFIABLE' : ''}</p>
      <h1 className="page-title">{r.description.length > 60 ? `${r.description.slice(0, 60)}…` : r.description}</h1>
      <p className={`page-subtitle ${closed ? '' : 'swms__status--active'}`}>{STATUS_LABEL[r.status]}{r.closed_at ? ` · ${fmtDate(r.closed_at.slice(0, 10))}` : ''}</p>
      {r.notifiable && !closed && (
        <p className="alert" role="alert">Notifiable: WorkSafe WA must be told immediately by phone, and the site left undisturbed until an inspector says otherwise.</p>
      )}

      <div className="item">
        <p className="label">The report — first account, frozen</p>
        <p className="incident__meta">
          {fmtDate(r.occurred_at.slice(0, 10))} {awstClock(r.occurred_at)}{r.location ? ` · ${r.location}` : ''} · reported by {r.reported_by_name} {awstClock(r.reported_on_device_at)}
          {r.notified_at ? ' · office emailed' : ''}
        </p>
        <p className="incident__text">{r.description}</p>
        {r.immediate_actions && <p><span className="label">Done straight away</span> {r.immediate_actions}</p>}
        {r.injured_name && (
          <p><span className="label">Hurt</span> {r.injured_name}{r.injury_type ? ` · ${r.injury_type}` : ''}{r.body_part ? ` · ${r.body_part}` : ''}{r.treatment ? ` · ${TREATMENT_LABEL[r.treatment]}` : ''}</p>
        )}
        {r.people_involved.length > 0 && <p><span className="label">Involved</span> {r.people_involved.join(', ')}</p>}
        {r.witnesses.length > 0 && <p><span className="label">Witnesses</span> {r.witnesses.join(', ')}</p>}
        {(r.actual_severity || r.potential_severity) && (
          <p><span className="label">Severity</span> {r.actual_severity ? SEVERITY_LABEL[r.actual_severity] : '—'} actual · {r.potential_severity ? SEVERITY_LABEL[r.potential_severity] : '—'} potential</p>
        )}
        {r.plant && <p><span className="label">Plant</span> {r.plant}</p>}
        {r.photo_urls.length > 0 && (
          <div className="photos__grid report-form__photos">
            {r.photo_urls.map((p) => (
              <figure key={p}>
                {urls[p] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <a href={urls[p]} target="_blank" rel="noopener"><img src={urls[p]} alt="" /></a>
                ) : <span className="talk-attendee__pending" />}
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="item">
        <p className="label">Corrective actions {openActions.length > 0 ? `· ${openActions.length} open` : r.actions.length ? '· all done' : ''}</p>
        {r.actions.length === 0 && <p className="nil">No actions yet.</p>}
        {r.actions.map((a) => {
          const late = actionOverdue(a, today);
          return (
            <div key={a.id} className={`incident__action${a.done_at ? ' incident__action--done' : late ? ' incident__action--late' : ''}`}>
              <div>
                <p className="incident__text">{a.action}</p>
                <p className="caption">
                  {a.owner_name ?? 'no owner'}{a.due_on ? ` · due ${fmtDate(a.due_on)}` : ''}{late ? ' · OVERDUE' : ''}
                  {a.done_at ? ` · done ${fmtDate(a.done_at.slice(0, 10))}${a.done_note ? ` — ${a.done_note}` : ''}` : ''}
                </p>
              </div>
              {!a.done_at && canManage && !closed && (
                <div className="signin__actions">
                  <input className="field field--sm" placeholder="How it was done" value={doneNote[a.id] ?? ''} onChange={(e) => setDoneNote({ ...doneNote, [a.id]: e.target.value })} />
                  <button type="button" className="button button--quiet signin__out" disabled={busy != null} onClick={() => void markDone(a.id)}>Done</button>
                  {a.created_by === userId && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void removeAction(a.id)}>Remove</button>}
                </div>
              )}
            </div>
          );
        })}
        {canManage && !closed && (
          <div className="incident__add">
            <label className="fieldcell"><span className="label">New action</span>
              <input className="field field--sm" value={action} placeholder="What has to happen so this does not happen again" onChange={(e) => setAction(e.target.value)} /></label>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Owner</span>
                <input className="field field--sm" value={owner} list="incident-owners" onChange={(e) => setOwner(e.target.value)} /></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Due</span>
                <input className="field field--sm" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            </div>
            <datalist id="incident-owners">{crew.map((c) => <option key={c} value={c} />)}</datalist>
            <button type="button" className="button button--quiet" disabled={busy != null || !action.trim()} onClick={() => void addAction()}>Add the action</button>
          </div>
        )}
      </div>

      <div className="item">
        <p className="label">Updates</p>
        {r.updates.length === 0 && <p className="nil">Nothing added yet.</p>}
        {r.updates.map((u) => (
          <div key={u.id} className="incident__update">
            <p className="caption">{UPDATE_KINDS.find((k) => k.key === u.kind)?.label ?? u.kind} · {u.by} · {fmtDate(u.created_at.slice(0, 10))} {awstClock(u.created_at)}</p>
            <p className="incident__text">{u.body}</p>
          </div>
        ))}
        {canReport && !closed && (
          <div className="incident__add">
            <div className="crewchips">
              {UPDATE_KINDS.map((k) => (
                <button key={k.key} type="button" className={`quotebtn crewchip${noteKind === k.key ? ' crewchip--on' : ''}`} onClick={() => setNoteKind(k.key)}>{k.label}</button>
              ))}
            </div>
            <textarea className="field field--sm" rows={3} value={note} placeholder="What has been found or done since" onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="button button--quiet" disabled={busy != null || !note.trim()} onClick={() => void addUpdate()}>Add the update</button>
          </div>
        )}
      </div>

      {error && <p className="alert" role="alert">{error}</p>}
      {canManage && !closed && (
        <div className="photo-add-pair">
          {r.status === 'open' ? (
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void setStatus('investigating')}>Under investigation</button>
          ) : (
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void setStatus('open')}>Back to open</button>
          )}
          <button type="button" className="button" disabled={busy != null || openActions.length > 0} onClick={() => void setStatus('closed')}>
            {openActions.length > 0 ? `Close (${openActions.length} action${openActions.length === 1 ? '' : 's'} open)` : 'Close the report'}
          </button>
        </div>
      )}
      <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void pdf()}>{busy === 'make the PDF' ? 'Making the PDF…' : 'Report PDF'}</button>
    </section>
  );
}
