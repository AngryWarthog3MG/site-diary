'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { normaliseName } from '@/lib/crew/tickets';
import {
  PERSON_KINDS, KIND_LABEL, splitDay, eventClock, hoursOnSite,
  type PersonKind, type SignInRow,
} from '@/lib/signin/register';
import { normaliseCompany, VERDICT_LABEL, type Verdict } from '@/lib/subcontractors/model';

type Row = SignInRow & { signed_in_by: string | null; pending?: boolean; self_signed?: boolean; contact?: string | null };

interface Props {
  projectId: string;
  date: string;
  isToday: boolean;
  rows: Row[];
  crew: string[];
  /** Normalised names inducted on this job, as of now. */
  inducted: string[];
  canRun: boolean;
  userId: string;
  /** The organisation's subcontractors and their paperwork verdict today. */
  companies?: Array<{ name: string; key: string; verdict: Verdict }>;
}

/**
 * The gate, on the phone. Tap a crew name to sign them in; type anyone else.
 * Sign-outs are one tap. With no signal every tap is queued and replayed
 * in order; the id and the time are the phone's, the arrival is the server's.
 */
export function SignInScreen(props: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(props.rows);
  const [inductedSet, setInductedSet] = useState(() => new Set(props.inducted));
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<PersonKind>('subcontractor');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const { onSite, left } = useMemo(() => splitDay(rows), [rows]);
  const onSiteNames = useMemo(() => new Set(onSite.map((r) => normaliseName(r.person_name))), [onSite]);
  const crewOff = props.crew.filter((c) => !onSiteNames.has(normaliseName(c)));

  async function signIn(personName: string, personKind: PersonKind, personCompany: string | null) {
    const trimmed = personName.trim();
    if (!trimmed) return;
    if (onSiteNames.has(normaliseName(trimmed))) {
      setError(`${trimmed} is already on site.`);
      return;
    }
    setBusy(trimmed);
    setError(null);
    const id = outbox.newId();
    const at = new Date().toISOString();
    const optimistic: Row = {
      id, person_name: trimmed, company: personCompany, person_kind: personKind,
      inducted: inductedSet.has(normaliseName(trimmed)),
      signed_in_at: at, signed_in_on_device_at: at, signed_out_at: null, signed_out_on_device_at: null,
      signed_in_by: props.userId, pending: true,
    };
    try {
      const live = async () => {
        const supabase = createClient();
        const { error: insErr } = await supabase.from('site_signins').insert({
          id, project_id: props.projectId, signin_date: props.date, person_name: trimmed,
          company: personCompany, person_kind: personKind, signed_in_on_device_at: at, signed_in_by: props.userId,
        });
        if (insErr) throw new Error(insErr.message);
      };
      const queue = () => outbox.enqueue({
        kind: 'signin_in', projectId: props.projectId, subjectId: id,
        payload: { date: props.date, name: trimmed, company: personCompany, kind: personKind, at, by: props.userId },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setRows((prev) => [...prev, { ...optimistic, pending: outcome !== 'sent' }]);
      setName('');
      setCompany('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-in did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function signOut(row: Row) {
    setBusy(row.id);
    setError(null);
    const at = new Date().toISOString();
    try {
      const live = async () => {
        const supabase = createClient();
        const { data, error: upErr } = await supabase.from('site_signins')
          .update({ signed_out_at: at, signed_out_on_device_at: at }).eq('id', row.id).select('id');
        if (upErr) throw new Error(upErr.message);
        if (!data || data.length === 0) throw new Error('That sign-out was not recorded — it may already be signed out. Refresh.');
      };
      const queue = () => outbox.enqueue({
        kind: 'signin_out', projectId: props.projectId, subjectId: row.id, payload: { at, date: props.date, name: row.person_name },
      }).then(() => undefined);
      const outcome = row.pending ? (await queue(), 'queued' as const) : await runOrQueue(live, queue);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, signed_out_at: at, signed_out_on_device_at: at } : r)));
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-out did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function signOutEveryone() {
    for (const row of onSite) await signOut(row);
  }

  /** A wrong tap, undone by the person who tapped it, while the row is open. Needs signal. */
  async function undo(row: Row) {
    setBusy(row.id);
    setError(null);
    try {
      if (row.pending) {
        // Never reached the server: take it out of the queue and it never will.
        for (const item of await outbox.forSubject(row.id)) await outbox.remove(item.id);
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        return;
      }
      const supabase = createClient();
      const { data, error: delErr } = await supabase.from('site_signins').delete().eq('id', row.id).select('id');
      if (delErr) throw new Error(delErr.message);
      if (!data || data.length === 0) throw new Error('That sign-in could not be removed — only whoever recorded it can, and only while it is open.');
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo that sign-in.');
    } finally {
      setBusy(null);
    }
  }

  async function inductNow(personName: string) {
    setError(null);
    try {
      const supabase = createClient();
      const { error: insErr } = await supabase.from('crew_inductions').insert({ project_id: props.projectId, person_name: personName, inducted_by: props.userId });
      if (insErr) throw new Error(insErr.message);
      setInductedSet((prev) => new Set([...prev, normaliseName(personName)]));
    } catch (err) {
      setError(err instanceof Error ? `Could not record the induction: ${err.message}` : 'Could not record the induction.');
    }
  }

  async function registerPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signin/pdf?project=${props.projectId}&date=${props.date}`, { method: 'POST' });
      const body = (await res.json()) as { url?: string; error?: { message?: string } };
      if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The register PDF could not be made.');
      window.open(body.url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The register PDF could not be made.');
    } finally {
      setPdfBusy(false);
    }
  }

  const inductedNow = (row: Row) => row.inducted || inductedSet.has(normaliseName(row.person_name));
  const companyFlag = (row: Row) => {
    if (!row.company || !props.companies) return null;
    const match = props.companies.find((c) => c.key === normaliseCompany(row.company ?? ''));
    if (!match) return row.person_kind === 'subcontractor' ? 'company not on the subcontractor list' : null;
    return match.verdict === 'compliant' ? null : VERDICT_LABEL[match.verdict].toUpperCase();
  };

  return (
    <section className="signin">
      {error && <p className="alert" role="alert">{error}</p>}

      <div className="signin__head">
        <h2 className="signin__title">On site now <span className="count">{onSite.length}</span></h2>
        {props.canRun && onSite.length > 0 && (
          <button type="button" className="linklike" disabled={busy != null} onClick={() => void signOutEveryone()}>Sign everyone out</button>
        )}
      </div>
      {onSite.length === 0 ? (
        <p className="nil">Nobody signed in{props.isToday ? ' yet' : ''}.</p>
      ) : (
        <ul className="signin__list">
          {onSite.map((row) => (
            <li key={row.id} className={`signin__row${row.pending ? ' signin__row--pending' : ''}`}>
              <div className="signin__who">
                <span className="signin__name">{row.person_name}</span>
                <span className="signin__meta">
                  {row.person_kind !== 'crew' ? KIND_LABEL[row.person_kind] : 'Crew'}
                  {row.company ? ` · ${row.company}` : ''}
                  {' · in '}{eventClock(row.signed_in_on_device_at, row.signed_in_at)}
                  {row.self_signed ? ' · via the gate' : ''}{row.contact ? ` · ${row.contact}` : ''}
                  {row.pending ? ' · waiting for signal' : ''}
                </span>
                {companyFlag(row) && <span className="signin__flag">{companyFlag(row)}</span>}
                {row.inducted === false && !inductedNow(row) ? (
                  <span className="signin__flag">
                    NOT INDUCTED
                    {props.canRun && <button type="button" className="linklike" onClick={() => void inductNow(row.person_name)}>Inducted now</button>}
                  </span>
                ) : row.inducted === false ? (
                  <span className="signin__ok">Inducted since sign-in</span>
                ) : null}
              </div>
              {props.canRun && (
                <div className="signin__actions">
                  <button type="button" className="button button--quiet signin__out" disabled={busy != null} onClick={() => void signOut(row)}>
                    {busy === row.id ? '…' : 'Sign out'}
                  </button>
                  {row.signed_in_by === props.userId && (
                    <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void undo(row)}>Wrong tap</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.canRun && (
        <div className="item signin__add">
          <p className="label">Sign someone in</p>
          {crewOff.length > 0 && (
            <div className="crewchips">
              {crewOff.map((c) => (
                <button key={c} type="button" className="quotebtn crewchip" disabled={busy != null} onClick={() => void signIn(c, 'crew', null)}>
                  + {c}
                </button>
              ))}
            </div>
          )}
          <label className="fieldcell">
            <span className="label">Name</span>
            <input className="field field--sm" value={name} placeholder="Someone not on the crew list" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">Company</span>
              <input className="field field--sm" value={company} list="signin-companies" placeholder="Optional" onChange={(e) => setCompany(e.target.value)} />
              <datalist id="signin-companies">{(props.companies ?? []).map((c) => <option key={c.name} value={c.name} />)}</datalist>
            </label>
            <label className="fieldcell fieldcell--narrow">
              <span className="label">Here as</span>
              <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as PersonKind)}>
                {PERSON_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="button" disabled={busy != null || !name.trim()} onClick={() => void signIn(name, kind, company.trim() || null)}>
            {busy === name.trim() && name.trim() ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      )}

      {left.length > 0 && (
        <>
          <h2 className="signin__title" style={{ marginTop: '1.25rem' }}>Left <span className="count">{left.length}</span></h2>
          <ul className="signin__list signin__list--left">
            {left.map((row) => (
              <li key={row.id} className="signin__row">
                <div className="signin__who">
                  <span className="signin__name">{row.person_name}</span>
                  <span className="signin__meta">
                    {row.person_kind !== 'crew' ? KIND_LABEL[row.person_kind] : 'Crew'}
                    {row.company ? ` · ${row.company}` : ''}
                    {' · '}{eventClock(row.signed_in_on_device_at, row.signed_in_at)} to {eventClock(row.signed_out_on_device_at, row.signed_out_at)}
                    {hoursOnSite(row) != null ? ` · ${hoursOnSite(row)} h` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <button type="button" className="button button--quiet" style={{ marginTop: '1rem' }} disabled={pdfBusy} onClick={() => void registerPdf()}>
          {pdfBusy ? 'Making the register…' : 'Register PDF for the day'}
        </button>
      )}
    </section>
  );
}
