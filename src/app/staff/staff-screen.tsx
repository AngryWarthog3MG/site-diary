'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { compressPhoto } from '@/lib/photos/compress';
import { fmtDate } from '@/lib/pdf/dates';
import { assignStep, filterStaff, type JobFilter, type Person, type PersonJob } from '@/lib/staff/model';

interface Job { id: string; code: string; name: string; canAssign: boolean }
interface Details { role: string; phone: string; employer: string; notes: string }
const BLANK_TICKET = { key: 'white_card', no: '', issued: '', expires: '', photo: null as File | null };

/**
 * The staff list, edited in place (README R123). Every save writes the record itself — the staff row, the job's crew
 * row, the ticket, the induction — then re-reads the page, so what is shown is what is stored. A ticket and an
 * induction are added here exactly as they are from the job's own screens; nothing is kept twice.
 */
export function StaffScreen({ orgId, orgName, projectId, userId, today, people, jobs, crewCounts, roles, competencies }: {
  orgId: string; orgName: string; projectId: string; userId: string; today: string;
  people: Person[]; jobs: Job[]; crewCounts: Record<string, number>; roles: string[];
  competencies: Array<{ key: string; label: string }>;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [showLeft, setShowLeft] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState({ name: '', role: '', phone: '', employer: '', jobs: [] as string[] });
  const [details, setDetails] = useState<Details | null>(null);
  const [ticket, setTicket] = useState(BLANK_TICKET);
  const [inducting, setInducting] = useState<string | null>(null);
  const [inductDate, setInductDate] = useState(today);
  const [inductNotes, setInductNotes] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [cards, setCards] = useState<Record<string, string>>({});

  const shown = filterStaff(people, q, jobFilter, showLeft);
  const left = people.filter((p) => !p.active).length;
  const open = people.find((p) => p.id === openId) ?? null;
  const jobOf = (id: string) => jobs.find((j) => j.id === id);

  // The cards behind the open person's tickets, as links that last the hour.
  const cardPaths = (open?.tickets ?? []).map((t) => t.photoPath).filter((p): p is string => Boolean(p)).join('\n');
  useEffect(() => {
    if (!cardPaths) return;
    let live = true;
    void (async () => {
      try {
        const { data } = await createClient().storage.from('crew-tickets').createSignedUrls(cardPaths.split('\n'), 3600);
        if (!live) return;
        const next: Record<string, string> = {};
        for (const d of data ?? []) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        setCards((c) => ({ ...c, ...next }));
      } catch { /* a card that will not open is not a reason to hide the ticket */ }
    })();
    return () => { live = false; };
  }, [cardPaths]);

  function toggle(p: Person) {
    setError(null); setSaved(null); setLeaving(false); setInducting(null); setTicket(BLANK_TICKET);
    if (openId === p.id) { setOpenId(null); setDetails(null); return; }
    setOpenId(p.id);
    setDetails({ role: p.role ?? '', phone: p.phone ?? '', employer: p.employer ?? '', notes: p.notes ?? '' });
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setSaved(null);
    try { setSaved(await fn()); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    // Re-read whatever happened: a save that half-landed (a person added, a job refused) must show as it stands.
    finally { setBusy(false); router.refresh(); }
  }
  const refused = (what: string) => new Error(`${what} did not save — your role on that job does not keep its crew list.`);

  async function putOnJob(name: string, role: string | null, job: PersonJob | { projectId: string; crewId: null; onCrew: false }) {
    const supabase = createClient();
    const step = 'code' in job ? assignStep(job) : 'insert';
    if (step === 'none') return;
    if (step === 'show' && job.crewId) {
      const { data, error: e } = await supabase.from('crew').update({ active: true }).eq('id', job.crewId).select('id');
      if (e) throw new Error(e.message);
      if (!data?.length) throw refused('That');
      return;
    }
    const { error: e } = await supabase.from('crew').insert({ project_id: job.projectId, name, role, sort_order: (crewCounts[job.projectId] ?? 0) + 1 });
    if (e) throw new Error(/row-level security/i.test(e.message) ? refused('That').message : e.message);
  }

  const addPerson = () => run(async () => {
    const name = fresh.name.replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Give the person’s name as it goes on the sheets.');
    const role = fresh.role.trim() || null;
    const { error: e } = await createClient().from('staff').insert({ org_id: orgId, name, role, phone: fresh.phone.trim() || null, employer: fresh.employer.trim() || null });
    if (e) throw new Error(/duplicate key/i.test(e.message) ? `${name} is already on the staff list.` : e.message);
    const failed: string[] = [];
    for (const id of fresh.jobs) {
      try { await putOnJob(name, role, { projectId: id, crewId: null, onCrew: false }); } catch { failed.push(jobOf(id)?.code ?? 'a job'); }
    }
    setFresh({ name: '', role: '', phone: '', employer: '', jobs: [] }); setAdding(false);
    if (failed.length) throw new Error(`${name} is on the staff list, but could not be put on ${failed.join(', ')}. Open their row and tick the job again.`);
    const on = fresh.jobs.map((id) => jobOf(id)?.code).filter(Boolean);
    return `${name} added${on.length ? ` and put on ${on.join(', ')}` : ''}.`;
  });

  const setJob = (p: Person, j: PersonJob, on: boolean) => run(async () => {
    if (on) { await putOnJob(p.name, p.role, j); return `${p.name} is on ${j.code}’s crew list.`; }
    if (!j.crewId) return '';
    const { data, error: e } = await createClient().from('crew').update({ active: false }).eq('id', j.crewId).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw refused('That');
    return `${p.name} is off ${j.code}’s crew list. Days already recorded are unchanged.`;
  });

  const induct = (p: Person, j: PersonJob) => run(async () => {
    if (!inductDate) throw new Error('Pick the day they were inducted.');
    if (inductDate > today) throw new Error('Record an induction once it has happened.');
    const { error: e } = await createClient().from('crew_inductions').insert({ project_id: j.projectId, person_name: p.name, inducted_on: inductDate, notes: inductNotes.trim() || null, inducted_by: userId });
    if (e) throw new Error(/duplicate key|one_per_person/i.test(e.message) ? `${p.name} is already inducted on ${j.code}.` : /row-level security/i.test(e.message) ? 'Your role on that job does not record inductions.' : e.message);
    setInducting(null); setInductNotes(''); setInductDate(today);
    return `${p.name} inducted on ${j.code}, ${fmtDate(inductDate)}.`;
  });

  const addTicket = (p: Person) => run(async () => {
    if (ticket.issued && ticket.issued > today) throw new Error('The issue date is in the future.');
    if (ticket.issued && ticket.expires && ticket.expires < ticket.issued) throw new Error('The expiry is before the issue date.');
    const supabase = createClient();
    const id = crypto.randomUUID();
    // The row first, so a card never sits in storage with nothing pointing at it; then the card; then the link.
    const { error: e } = await supabase.from('crew_tickets').insert({ id, org_id: orgId, person_name: p.name, ticket_type: ticket.key, ticket_no: ticket.no.trim() || null, issued_on: ticket.issued || null, expires_on: ticket.expires || null, created_by: userId });
    if (e) throw new Error(e.message);
    let note = '';
    if (ticket.photo) {
      try {
        const c = await compressPhoto(ticket.photo);
        const path = `${orgId}/${id}.${c.extension}`;
        const { error: upErr } = await supabase.storage.from('crew-tickets').upload(path, c.blob, { contentType: c.contentType, upsert: false });
        if (upErr) note = ` The card did not upload: ${upErr.message}`;
        else {
          const { data: linked, error: linkErr } = await supabase.from('crew_tickets').update({ photo_path: path }).eq('id', id).select('id');
          if (linkErr || !linked?.length) note = ' The card uploaded but could not be linked to the ticket — the nightly check will report it.';
        }
      } catch { note = ' The card could not be read, so the ticket was saved without it.'; }
    }
    const label = competencies.find((c) => c.key === ticket.key)?.label ?? 'Ticket';
    setTicket(BLANK_TICKET);
    return `${label} recorded for ${p.name}.${note}`;
  });

  const retire = (p: Person, id: string, label: string) => run(async () => {
    const { data, error: e } = await createClient().from('crew_tickets').update({ active: false }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('That ticket could not be removed.');
    return `${label} removed from ${p.name}.`;
  });

  const saveDetails = (p: Person) => run(async () => {
    if (!details) return '';
    const { data, error: e } = await createClient().from('staff').update({ role: details.role.trim() || null, phone: details.phone.trim() || null, employer: details.employer.trim() || null, notes: details.notes.trim() || null }).eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('Those details could not be saved.');
    return `${p.name}’s details saved.${(details.role.trim() || null) !== p.role ? ' The role has gone to their crew lists too.' : ''}`;
  });

  const setActive = (p: Person, active: boolean) => run(async () => {
    const { data, error: e } = await createClient().from('staff').update({ active }).eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('That could not be saved.');
    setLeaving(false);
    return active ? `${p.name} is back on the staff list. Tick the jobs they are on.` : `${p.name} is marked as no longer with ${orgName} and is off every crew list.`;
  });

  const tone = (p: Person) => (!p.active ? 'none' : p.worst === 'expired' || p.gaps.length ? 'expired' : p.worst === 'expiring' || p.notInducted.length ? 'soon' : p.worst === 'none' ? 'none' : 'ok');
  const jobsLine = (p: Person) => {
    const on = p.jobs.filter((j) => j.onCrew).map((j) => j.code);
    return on.length ? on.join(', ') : 'Not on a job';
  };
  const ticketsLine = (p: Person) => {
    if (p.tickets.length === 0) return 'No tickets recorded';
    const x = p.tickets.filter((t) => t.state === 'expired').length;
    const s = p.tickets.filter((t) => t.state === 'expiring').length;
    return `${p.tickets.length} ticket${p.tickets.length === 1 ? '' : 's'}${x ? ` · ${x} expired` : ''}${s ? ` · ${s} expiring` : ''}`;
  };

  return (
    <section className="staff">
      <hr className="rule" />
      <div className="staff__tools">
        <input className="field field--sm" type="search" placeholder="Find a name or a role…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
        <select className="field field--sm" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Show people on">
          <option value="all">Everyone</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>On {j.code} · {j.name}</option>)}
          <option value="none">Not on a job</option>
        </select>
        {left > 0 && <label className="regs__tick"><input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /><span>Show {left} no longer with the company</span></label>}
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {saved && <p className="notice" role="status">{saved}</p>}

      {!adding ? (
        <div className="regs__actions"><button type="button" className="button" onClick={() => { setAdding(true); setError(null); setSaved(null); }}>Add a person</button></div>
      ) : (
        <div className="item staff__add">
          <p className="label">New person</p>
          <div className="regs__fields">
            <label className="fieldcell regs__field"><span className="label">Name, as it goes on the sheets</span>
              <input className="field field--sm" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Role</span>
              <input className="field field--sm" list="staff-roles" placeholder="Labourer, Machine Op…" value={fresh.role} onChange={(e) => setFresh({ ...fresh, role: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Phone · optional</span>
              <input className="field field--sm" inputMode="tel" value={fresh.phone} onChange={(e) => setFresh({ ...fresh, phone: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Employer, if not {orgName}</span>
              <input className="field field--sm" placeholder="Labour hire or subcontractor" value={fresh.employer} onChange={(e) => setFresh({ ...fresh, employer: e.target.value })} /></label>
          </div>
          {jobs.length > 0 && (
            <>
              <p className="label regs__sub">Put them on</p>
              <div className="regs__ticks regs__ticks--dense">
                {jobs.map((j) => (
                  <label key={j.id} className="regs__tick"><input type="checkbox" disabled={!j.canAssign} checked={fresh.jobs.includes(j.id)}
                    onChange={(e) => setFresh({ ...fresh, jobs: e.target.checked ? [...fresh.jobs, j.id] : fresh.jobs.filter((x) => x !== j.id) })} /><span><b>{j.code}</b> {j.name}</span></label>
                ))}
              </div>
            </>
          )}
          <div className="regs__actions">
            <button type="button" className="button" disabled={busy || !fresh.name.trim()} onClick={() => void addPerson()}>{busy ? 'Saving…' : 'Add to the staff list'}</button>
            <button type="button" className="quotebtn" disabled={busy} onClick={() => setAdding(false)}>Close</button>
          </div>
        </div>
      )}
      <datalist id="staff-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>

      <p className="label" style={{ marginTop: '1.25rem' }}>{shown.length === people.filter((p) => p.active || showLeft).length ? `Staff · ${shown.length}` : `Showing ${shown.length} of ${people.filter((p) => p.active || showLeft).length}`}</p>
      {people.length === 0 && <p className="claims-nil">Nobody on the staff list yet. Add the first person above.</p>}
      {people.length > 0 && shown.length === 0 && <p className="claims-nil">Nobody matches.</p>}
      <ul className="tickets__people staff__list">
        {shown.map((p) => {
          const isOpen = openId === p.id;
          return (
            <li key={p.id} className={`ticketrow ticketrow--${tone(p)}${p.active ? '' : ' staff__gone'}`}>
              <button type="button" className="ticketrow__head" aria-expanded={isOpen} onClick={() => toggle(p)}>
                <span className="machine__name">{p.name}</span>
                <span className="machine__meta">
                  {p.active ? (p.role ?? 'No role set') : `No longer with ${orgName}`}{p.employer ? ` · ${p.employer}` : ''} · {jobsLine(p)} · {ticketsLine(p)}
                  {p.notInducted.length > 0 && <span className="staff__flag"> · not inducted on {p.notInducted.join(', ')}</span>}
                  {p.gaps.length > 0 && <span className="staff__flag staff__flag--bad"> · needs {p.gaps.join(', ')}</span>}
                </span>
              </button>
              {isOpen && details && (
                <div className="ticketrow__body staff__body">
                  {p.logins.length > 0 && <p className="caption">App login: {p.logins.join(' · ')}</p>}

                  <p className="label">Jobs · the crew list each job’s diary offers</p>
                  {jobs.length === 0 && <p className="caption">No active job on your account.</p>}
                  {p.jobs.map((j) => {
                    const job = jobOf(j.projectId);
                    const key = `${p.id}|${j.projectId}`;
                    return (
                      <div key={j.projectId} className="staff__job">
                        <label className="regs__tick">
                          <input type="checkbox" checked={j.onCrew} disabled={busy || !p.active || !job?.canAssign} onChange={(e) => void setJob(p, j, e.target.checked)} />
                          <span><b>{j.code}</b> {j.name}{j.jobRole ? <span className="caption"> · {j.jobRole} on this job</span> : null}</span>
                        </label>
                        <span className="staff__ind">
                          {j.inductedOn
                            ? <span className="caption">Inducted {fmtDate(j.inductedOn)}{j.inductionNotes ? ` · ${j.inductionNotes}` : ''}</span>
                            : <span className={j.onCrew ? 'staff__flag' : 'caption'}>Not inducted here</span>}
                          {!j.inductedOn && job?.canAssign && inducting !== key && (
                            <button type="button" className="quotebtn" disabled={busy} onClick={() => { setInducting(key); setInductDate(today); setInductNotes(''); setError(null); }}>Record induction</button>
                          )}
                        </span>
                        {inducting === key && (
                          <div className="staff__induct">
                            <label className="fieldcell"><span className="label">Inducted on</span>
                              <input className="field field--sm" type="date" max={today} value={inductDate} onChange={(e) => setInductDate(e.target.value)} /></label>
                            <label className="fieldcell staff__grow"><span className="label">What was covered · optional</span>
                              <input className="field field--sm" value={inductNotes} onChange={(e) => setInductNotes(e.target.value)} /></label>
                            <button type="button" className="button button--quiet" disabled={busy} onClick={() => void induct(p, j)}>{busy ? 'Saving…' : 'Save induction'}</button>
                            <button type="button" className="quotebtn" disabled={busy} onClick={() => setInducting(null)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <p className="label staff__head">Tickets and certificates · {p.tickets.length}</p>
                  {p.gaps.length > 0 && <p className="staff__flag staff__flag--bad">Their role needs, and they do not hold in date: {p.gaps.join(', ')}.</p>}
                  {p.tickets.length === 0 && <p className="caption">None recorded.</p>}
                  {p.tickets.map((t) => (
                    <div key={t.id} className={`ticket ticket--${t.state === 'expiring' ? 'soon' : t.state === 'expired' ? 'expired' : 'ok'}`}>
                      <span>
                        <b>{t.label}</b>
                        {t.ticketNo ? <span className="mono"> · {t.ticketNo}</span> : null}
                        {t.issuedOn ? ` · issued ${fmtDate(t.issuedOn)}` : ''}
                        {t.expiresOn ? ` · ${t.state === 'expired' ? 'expired' : 'expires'} ${fmtDate(t.expiresOn)}` : ' · no expiry'}
                        {t.photoPath && cards[t.photoPath] ? <> · <a href={cards[t.photoPath]} target="_blank" rel="noopener">Card</a></> : null}
                      </span>
                      <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => void retire(p, t.id, t.label)}>Remove</button>
                    </div>
                  ))}
                  {p.active && (
                    <div className="addticket">
                      <div className="regs__fields">
                        <label className="fieldcell regs__field"><span className="label">Ticket or certificate</span>
                          <select className="field field--sm" value={ticket.key} onChange={(e) => setTicket({ ...ticket, key: e.target.value })}>
                            {competencies.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                            <option value="other">Other</option>
                          </select></label>
                        <label className="fieldcell regs__field"><span className="label">Number</span>
                          <input className="field field--sm" value={ticket.no} onChange={(e) => setTicket({ ...ticket, no: e.target.value })} /></label>
                        <label className="fieldcell regs__field"><span className="label">Issued</span>
                          <input className="field field--sm" type="date" max={today} value={ticket.issued} onChange={(e) => setTicket({ ...ticket, issued: e.target.value })} /></label>
                        <label className="fieldcell regs__field"><span className="label">Expires · blank if never</span>
                          <input className="field field--sm" type="date" value={ticket.expires} onChange={(e) => setTicket({ ...ticket, expires: e.target.value })} /></label>
                      </div>
                      <div className="regs__actions">
                        <label className="button button--quiet">
                          {ticket.photo ? 'Card attached' : 'Photo of the card'}
                          <input type="file" accept="image/*" hidden onChange={(e) => setTicket({ ...ticket, photo: e.target.files?.[0] ?? null })} />
                        </label>
                        <button type="button" className="button button--quiet" disabled={busy} onClick={() => void addTicket(p)}>{busy ? 'Saving…' : 'Add ticket'}</button>
                      </div>
                    </div>
                  )}

                  <p className="label staff__head">Details</p>
                  <div className="regs__fields">
                    <label className="fieldcell regs__field"><span className="label">Role</span>
                      <input className="field field--sm" list="staff-roles" value={details.role} onChange={(e) => setDetails({ ...details, role: e.target.value })} /></label>
                    <label className="fieldcell regs__field"><span className="label">Phone</span>
                      <input className="field field--sm" inputMode="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} /></label>
                    <label className="fieldcell regs__field"><span className="label">Employer, if not {orgName}</span>
                      <input className="field field--sm" value={details.employer} onChange={(e) => setDetails({ ...details, employer: e.target.value })} /></label>
                    <label className="fieldcell regs__field regs__field--wide"><span className="label">Notes</span>
                      <input className="field field--sm" value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} /></label>
                  </div>
                  <div className="regs__actions">
                    <button type="button" className="button button--quiet" disabled={busy} onClick={() => void saveDetails(p)}>{busy ? 'Saving…' : 'Save details'}</button>
                    {p.active && !leaving && <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => setLeaving(true)}>No longer with the company</button>}
                    {!p.active && <button type="button" className="quotebtn" disabled={busy} onClick={() => void setActive(p, true)}>Back with the company</button>}
                  </div>
                  {leaving && p.active && (
                    <div className="staff__leave">
                      <p className="caption">{p.name} comes off every job’s crew list and stays on the record: the tickets, inductions and every day already signed keep the name.</p>
                      <div className="regs__actions">
                        <button type="button" className="button button--quiet" disabled={busy} onClick={() => void setActive(p, false)}>Yes, they have left</button>
                        <button type="button" className="quotebtn" disabled={busy} onClick={() => setLeaving(false)}>Keep</button>
                      </div>
                    </div>
                  )}
                  <p className="caption">The name is what the tickets, inductions and diaries are filed under, so it is not changed here.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
