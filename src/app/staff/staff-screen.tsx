'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { compressPhoto } from '@/lib/photos/compress';
import { fmtDate } from '@/lib/pdf/dates';
import { filterStaff, type JobFilter, type Person, type PersonJob } from '@/lib/staff/model';
import { ROLES, ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { AccessGrid, MoneyAccess, type MemberRow } from '@/app/settings/members/members-form';
import { Fold } from '@/components/fold';

interface Job { id: string; code: string; name: string; canAssign: boolean; /** The viewer is an admin of this job: the money, the people-manager flag (R136). */ isAdmin: boolean; /** The viewer manages people on this job — an admin, or a PM marked for it (R150). */ managesPeople: boolean }
interface Details { role: string; phone: string; employer: string; notes: string; emergency: string }
/** Where on the page a save's answer is shown: beside the thing that was pressed, never off the top of the screen. */
type Where = 'top' | 'jobs' | 'tickets' | 'details' | 'rename' | 'login';
/** The crew's password, typed once and kept on this device (README R147) — never on the server. */
const PW_KEY = 'kbl-members-password';
interface Msg { where: Where; kind: 'ok' | 'bad' | 'warn'; text: string }
type PersonTab = 'jobs' | 'tickets' | 'login' | 'details';
const BLANK_TICKET = { key: 'white_card', no: '', issued: '', expires: '', photo: null as File | null };

/**
 * The staff list, edited in place (README R123). Every save writes the record itself — the staff row, the job's crew
 * row, the ticket, the induction — then re-reads the page, so what is shown is what is stored. A ticket and an
 * induction are added here exactly as they are from the job's own screens; nothing is kept twice.
 */
export function StaffScreen({ orgId, orgName, projectId, userId, today, people, jobs, crewCounts, roles, competencies, codeEntered, initialJob, offList = [] }: {
  orgId: string; orgName: string; projectId: string; userId: string; today: string;
  people: Person[]; jobs: Job[]; crewCounts: Record<string, number>; roles: string[];
  competencies: Array<{ key: string; label: string }>;
  /** The viewer's two-factor code is entered this session (R106): what grants money or resets a code is open. */
  codeEntered: boolean;
  /** The job the page opened filtered to, when it came from a job's Settings (README R148). */
  initialJob?: JobFilter;
  /** Logins on the company's jobs with no staff row yet — offered here, so the page is everyone (README R148). */
  offList?: Array<{ name: string; where: string[] }>;
}) {
  void crewCounts;
  const router = useRouter();
  const [q, setQ] = useState('');
  const [jobFilter, setJobFilter] = useState<JobFilter>(initialJob ?? 'all');
  const [showLeft, setShowLeft] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const ticketsRef = useRef<HTMLDivElement | null>(null);

  const [adding, setAdding] = useState(false);
  const [withLogin, setWithLogin] = useState(false);
  /** Which part of the open person is showing (README R157): the jobs, the tickets, the login or the details. */
  const [tab, setTab] = useState<PersonTab>('jobs');
  const [fresh, setFresh] = useState({ name: '', role: '', phone: '', employer: '', emergency: '', email: '', password: '', title: 'labourer' as MemberRole, jobs: [] as string[] });
  const [rememberPw, setRememberPw] = useState(true);
  useEffect(() => { try { const kept = window.localStorage.getItem(PW_KEY); if (kept) setFresh((f) => ({ ...f, password: kept })); } catch { /* no storage */ } }, []);
  // Giving someone on the list a login, from their row.
  const [loginForm, setLoginForm] = useState<{ email: string; password: string; title: MemberRole } | null>(null);
  const [pwFor, setPwFor] = useState<{ userId: string; value: string } | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [ticket, setTicket] = useState(BLANK_TICKET);
  const [inducting, setInducting] = useState<string | null>(null);
  const [inductDate, setInductDate] = useState(today);
  const [inductNotes, setInductNotes] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [cards, setCards] = useState<Record<string, string>>({});
  // A job tick shows the moment it is tapped; the page's own answer replaces it when the save has been re-read.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  useEffect(() => { setTicked({}); }, [people]);

  // A card that has been picked but not saved is the easiest thing on this page to lose: say so, show it, and do not
  // let the row close or the tab go without a word.
  const ticketDirty = Boolean(ticket.photo || ticket.no.trim() || ticket.issued || ticket.expires);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!ticket.photo || !ticket.photo.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(ticket.photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [ticket.photo]);
  useEffect(() => {
    if (!ticketDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ticketDirty]);
  const pointAtTicket = (text: string) => {
    setMsg({ where: 'tickets', kind: 'warn', text });
    ticketsRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const say = (where: Where) => (msg && msg.where === where
    ? <p className={msg.kind === 'bad' ? 'alert' : msg.kind === 'warn' ? 'notice gap' : 'notice'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>
    : null);

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
    if (ticketDirty && openId) { pointAtTicket('This ticket is not saved yet. Press Save ticket, or Clear to drop it.'); return; }
    setMsg(null); setLeaving(false); setRenaming(false); setNewName(''); setInducting(null); setTicket(BLANK_TICKET); setLoginForm(null); setPwFor(null);
    if (openId === p.id) { setOpenId(null); setDetails(null); return; }
    setOpenId(p.id);
    setTab(p.gaps.length || p.worst === 'expired' ? 'tickets' : 'jobs');
    setDetails({ role: p.role ?? '', phone: p.phone ?? '', employer: p.employer ?? '', notes: p.notes ?? '', emergency: p.emergency_contact ?? '' });
  }

  function switchTab(next: PersonTab) {
    if (ticketDirty && next !== 'tickets') { pointAtTicket('This ticket is not saved yet. Press Save ticket, or Clear to drop it.'); setTab('tickets'); return; }
    setMsg(null); setTab(next);
  }

  async function run(where: Where, fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { const text = await fn(); setMsg(text ? { where, kind: 'ok', text } : null); }
    catch (e) { setMsg({ where, kind: 'bad', text: e instanceof Error ? e.message : 'That did not save.' }); }
    // Re-read whatever happened: a save that half-landed (a person added, a job refused) must show as it stands.
    finally { setBusy(false); router.refresh(); }
  }
  /** The People API (README R148) and the members API: one call, one plain answer. */
  async function api(method: string, url: string, body: object): Promise<string> {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'That did not save.');
    return String(json?.message ?? 'Saved.');
  }
  const keepPassword = (pw: string) => { try { if (rememberPw && pw) window.localStorage.setItem(PW_KEY, pw); else if (!rememberPw) window.localStorage.removeItem(PW_KEY); } catch { /* no storage */ } };

  const addPerson = () => run('top', async () => {
    const name = fresh.name.replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Give the person’s name as it goes on the sheets.');
    if (withLogin && !fresh.email.trim()) throw new Error('Their email is what they sign in with — or untick the login.');
    if (withLogin && fresh.password && fresh.password.length < 8) throw new Error('A password is at least 8 characters.');
    const text = await api('POST', '/api/people', {
      orgId, name, role: fresh.role, phone: fresh.phone, employer: fresh.employer, emergencyContact: fresh.emergency,
      email: withLogin ? fresh.email.trim() : '', password: withLogin ? fresh.password : '', title: fresh.title, jobs: fresh.jobs,
    });
    keepPassword(fresh.password);
    setFresh((f) => ({ name: '', role: '', phone: '', employer: '', emergency: '', email: '', password: f.password, title: 'labourer', jobs: [] })); setAdding(false); setWithLogin(false);
    return text;
  });

  // One tick: the crew list, and the login's membership where there is one (README R148).
  const setJob = (p: Person, j: PersonJob, on: boolean) => {
    const key = `${p.id}|${j.projectId}`;
    setTicked((t) => ({ ...t, [key]: on }));
    return run('jobs', async () => {
      try {
        const title = (p.login?.memberships[0]?.role as MemberRole | undefined) ?? 'labourer';
        return await api('PUT', '/api/people', { staffId: p.id, projectId: j.projectId, on, title });
      } catch (e) {
        setTicked((t) => { const { [key]: _gone, ...rest } = t; void _gone; return rest; });
        throw e;
      }
    });
  };

  // A login with no staff row: one tap makes the row; the login joins it by name, and the jobs follow on the row.
  const addFromLogin = (name: string) => run('top', async () => api('POST', '/api/people', { orgId, name, jobs: [] }));

  // Their login: made from the row, for the jobs they are on.
  const giveLogin = (p: Person) => run('login', async () => {
    if (!loginForm) return '';
    const email = loginForm.email.trim().toLowerCase();
    if (!email) throw new Error('Their email is what they sign in with.');
    if (loginForm.password && loginForm.password.length < 8) throw new Error('A password is at least 8 characters.');
    const text = await api('POST', '/api/people', { orgId, name: p.name, role: p.role ?? '', email, password: loginForm.password, title: loginForm.title, jobs: p.jobs.filter((j) => j.onCrew).map((j) => j.projectId) });
    keepPassword(loginForm.password);
    setLoginForm(null);
    return text;
  });
  const setPassword = (p: Person) => run('login', async () => {
    if (!p.login || !pwFor) return '';
    if (pwFor.value.length < 8) throw new Error('A password is at least 8 characters.');
    const job = p.login.memberships.find((m) => jobOf(m.projectId)?.managesPeople);
    if (!job) throw new Error('Only someone who manages people on one of their jobs sets their password.');
    const text = await api('PATCH', `/api/projects/${job.projectId}/members`, { userId: p.login.userId, password: pwFor.value });
    setPwFor(null);
    return text;
  });
  const setTitle = (p: Person, projectId: string, role: MemberRole) => run('login', async () => {
    if (!p.login) return '';
    return await api('PATCH', `/api/projects/${projectId}/members`, { userId: p.login.userId, role });
  });
  const resetTwoFactor = (p: Person) => run('login', async () => {
    if (!p.login) return '';
    const job = p.login.memberships.find((m) => jobOf(m.projectId)?.isAdmin);
    if (!job) throw new Error('Only an admin of one of their jobs resets their two-factor.');
    return await api('POST', `/api/projects/${job.projectId}/members/two-factor`, { userId: p.login.userId });
  });
  const memberRow = (p: Person, m: NonNullable<Person['login']>['memberships'][number]): MemberRow => ({
    userId: p.login!.userId, role: m.role as MemberRole, screens: m.screens, finance: m.finance, twoFactor: null, name: p.name, email: p.login!.email, isCurrentUser: p.login!.userId === userId,
  });

  const induct = (p: Person, j: PersonJob) => run('jobs', async () => {
    if (!inductDate) throw new Error('Pick the day they were inducted.');
    if (inductDate > today) throw new Error('Record an induction once it has happened.');
    const { error: e } = await createClient().from('crew_inductions').insert({ project_id: j.projectId, person_name: p.name, inducted_on: inductDate, notes: inductNotes.trim() || null, inducted_by: userId });
    if (e) throw new Error(/duplicate key|one_per_person/i.test(e.message) ? `${p.name} is already inducted on ${j.code}.` : /row-level security/i.test(e.message) ? 'Your role on that job does not record inductions.' : e.message);
    setInducting(null); setInductNotes(''); setInductDate(today);
    return `${p.name} inducted on ${j.code}, ${fmtDate(inductDate)}.`;
  });

  const addTicket = (p: Person) => run('tickets', async () => {
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
    const withCard = Boolean(ticket.photo) && !note;
    setTicket(BLANK_TICKET);
    if (note) throw new Error(`${label} recorded for ${p.name}, without its card.${note} Remove the ticket and add it again with the card, or leave it as it is.`);
    return `${label} recorded for ${p.name}${withCard ? ', with its card' : ''}.`;
  });

  const retire = (p: Person, id: string, label: string) => run('tickets', async () => {
    const { data, error: e } = await createClient().from('crew_tickets').update({ active: false }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('That ticket could not be removed.');
    return `${label} removed from ${p.name}.`;
  });

  const saveDetails = (p: Person) => run('details', async () => {
    if (!details) return '';
    const { data, error: e } = await createClient().from('staff').update({ role: details.role.trim() || null, phone: details.phone.trim() || null, employer: details.employer.trim() || null, notes: details.notes.trim() || null, emergency_contact: details.emergency.trim() || null }).eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('Those details could not be saved.');
    return `${p.name}’s details saved.${(details.role.trim() || null) !== p.role ? ' The role has gone to their crew lists too.' : ''}${ticketDirty ? ' The ticket above is NOT saved yet — press Save ticket.' : ''}`;
  });

  // A rename goes through the database's rename_staff (README R140): the staff row, the crew lists, the tickets and the
  // inductions take the new name; signed days keep the old one and an alias folds it in on the timesheet.
  const rename = (p: Person) => run('rename', async () => {
    const name = newName.replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Give the person their name.');
    const { data, error: e } = await createClient().rpc('rename_staff', { p_staff_id: p.id, p_name: name });
    if (e) throw new Error(e.message);
    const r = (data ?? {}) as { old_name?: string; new_name?: string; crew_rows?: number; tickets?: number; inductions?: number };
    setRenaming(false); setNewName('');
    return `${r.old_name ?? p.name} is now ${r.new_name ?? name}: ${r.crew_rows ?? 0} crew ${r.crew_rows === 1 ? 'row' : 'rows'}, ${r.tickets ?? 0} ${r.tickets === 1 ? 'ticket' : 'tickets'} and ${r.inductions ?? 0} ${r.inductions === 1 ? 'induction' : 'inductions'} carry the new name. Days already signed keep “${r.old_name ?? p.name}” and are added up under the new name.`;
  });

  const setActive = (p: Person, active: boolean) => run(active ? 'details' : 'top', async () => {
    if (!active) {
      // Leaving (README R148): off every crew list, off every job as a member, the login closed — the People API.
      const text = await api('DELETE', '/api/people', { staffId: p.id });
      setLeaving(false);
      return text;
    }
    const { data, error: e } = await createClient().from('staff').update({ active }).eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('That could not be saved.');
    return `${p.name} is back on the staff list. Tick the jobs they are on.`;
  });

  const tone = (p: Person) => (!p.active ? 'gone' : p.worst === 'expired' || p.gaps.length || p.login?.closed ? 'bad' : p.worst === 'expiring' || p.notInducted.length ? 'warn' : 'ok');
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const onJobs = (p: Person) => p.jobs.filter((j) => j.onCrew);
  /** What the row says at a glance (README R157): only what needs a look, never a column of "fine". */
  const badges = (p: Person) => {
    const out: Array<{ tone: 'bad' | 'warn' | 'ok' | 'mute'; text: string }> = [];
    if (!p.active) { out.push({ tone: 'mute', text: `No longer with ${orgName}` }); return out; }
    if (p.gaps.length) out.push({ tone: 'bad', text: `Needs ${p.gaps.join(', ')}` });
    const x = p.tickets.filter((t) => t.state === 'expired').length;
    const s = p.tickets.filter((t) => t.state === 'expiring').length;
    if (x) out.push({ tone: 'bad', text: `${x} ticket${x === 1 ? '' : 's'} expired` });
    if (s) out.push({ tone: 'warn', text: `${s} expiring` });
    if (p.notInducted.length) out.push({ tone: 'warn', text: `Not inducted ${p.notInducted.join(', ')}` });
    if (p.login?.closed) out.push({ tone: 'bad', text: 'Account closed' });
    if (!x && !s && p.tickets.length) out.push({ tone: 'ok', text: `${p.tickets.length} ticket${p.tickets.length === 1 ? '' : 's'}` });
    if (!p.tickets.length && !p.gaps.length) out.push({ tone: 'mute', text: 'No tickets' });
    if (!p.login) out.push({ tone: 'mute', text: 'No login' });
    return out;
  };
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

  return (
    <section className="staff pe">
      <div className="pe-tools">
        <input className="field field--sm pe-tools__find" type="search" placeholder="Find a name or a role…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
        <select className="field field--sm pe-tools__job" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Show people on">
          <option value="all">Everyone</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>On {j.code} · {j.name}</option>)}
          <option value="none">Not on a job</option>
        </select>
        {!adding && <button type="button" className="button pe-tools__add" onClick={() => { setAdding(true); setMsg(null); }}>+ Add a person</button>}
      </div>
      {left > 0 && <label className="regs__tick pe-left"><input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /><span>Show {count(left, 'person').replace('persons', 'people')} no longer with the company</span></label>}
      {say('top')}

      {adding && (
        <div className="pe-add">
          <div className="pe-add__head">
            <p className="label">New person</p>
            <button type="button" className="quotebtn" disabled={busy} onClick={() => setAdding(false)}>Close</button>
          </div>
          <div className="regs__fields">
            <label className="fieldcell regs__field"><span className="label">Name, as it goes on the sheets</span>
              <input className="field field--sm" autoFocus value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Role</span>
              <input className="field field--sm" list="staff-roles" placeholder="Labourer, Machine Op…" value={fresh.role} onChange={(e) => setFresh({ ...fresh, role: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Phone · optional</span>
              <input className="field field--sm" inputMode="tel" value={fresh.phone} onChange={(e) => setFresh({ ...fresh, phone: e.target.value })} /></label>
            <label className="fieldcell regs__field"><span className="label">Employer, if not {orgName}</span>
              <input className="field field--sm" placeholder="Labour hire or subcontractor" value={fresh.employer} onChange={(e) => setFresh({ ...fresh, employer: e.target.value })} /></label>
            <label className="fieldcell regs__field regs__field--wide"><span className="label">Emergency contact · optional</span>
              <input className="field field--sm" placeholder="Name and number" value={fresh.emergency} onChange={(e) => setFresh({ ...fresh, emergency: e.target.value })} /></label>
          </div>
          {jobs.length > 0 && (
            <>
              <p className="label regs__sub">Put them on</p>
              <div className="pe-jobpick">
                {jobs.map((j) => {
                  const on = fresh.jobs.includes(j.id);
                  return (
                    <button key={j.id} type="button" className={`pe-jobchip${on ? ' pe-jobchip--on' : ''}`} disabled={!j.canAssign} aria-pressed={on}
                      onClick={() => setFresh({ ...fresh, jobs: on ? fresh.jobs.filter((x) => x !== j.id) : [...fresh.jobs, j.id] })}>
                      <b>{j.code}</b> {j.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <label className="regs__tick pe-add__login"><input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} /><span>Give them a login to the app</span></label>
          {withLogin && (
            <div className="pe-add__loginbox">
              <div className="regs__fields">
                <label className="fieldcell regs__field"><span className="label">Email · what they sign in with</span>
                  <input className="field field--sm" type="email" autoCapitalize="none" autoComplete="off" inputMode="email" autoFocus value={fresh.email} onChange={(e) => setFresh({ ...fresh, email: e.target.value })} /></label>
                <label className="fieldcell regs__field"><span className="label">Title in the app</span>
                  <select className="field field--sm" value={fresh.title} onChange={(e) => setFresh({ ...fresh, title: e.target.value as MemberRole })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select></label>
                <label className="fieldcell regs__field"><span className="label">Password · at least 8 characters</span>
                  <input className="field field--sm" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Blank: they sign in by a link" value={fresh.password} onChange={(e) => setFresh({ ...fresh, password: e.target.value })} /></label>
                <label className="regs__tick regs__field"><input type="checkbox" checked={rememberPw} onChange={(e) => setRememberPw(e.target.checked)} /><span>Keep this password on this device for the next person</span></label>
              </div>
              <p className="caption">They get a login on every job picked above, with that title. The password is told to them in person — the app never sends it.</p>
            </div>
          )}
          <div className="regs__actions">
            <button type="button" className="button" disabled={busy || !fresh.name.trim()} onClick={() => void addPerson()}>{busy ? 'Saving…' : withLogin && fresh.email.trim() ? 'Add them, with their login' : 'Add them'}</button>
            <button type="button" className="quotebtn" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      <datalist id="staff-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>

      {offList.length > 0 && (
        <div className="item staff__offlist">
          <p className="label">Logins not on the list yet · {offList.length}</p>
          <p className="caption">These people can sign in but are on no staff row, so the diary, the prestart and the gate half-know them. Add each one and their login joins the row; then tick their jobs and set a role on it.</p>
          <ul className="plainlist">
            {offList.map((o) => (
              <li key={o.name} className="staff__offrow">
                <span><b>{o.name}</b> <span className="caption">· {o.where.join(' · ')}</span></span>
                <button type="button" className="quotebtn" disabled={busy} onClick={() => void addFromLogin(o.name)}>Add to the list</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="label pe-count">{shown.length === people.filter((p) => p.active || showLeft).length ? `Staff · ${shown.length}` : `Showing ${shown.length} of ${people.filter((p) => p.active || showLeft).length}`}</p>
      {people.length === 0 && <p className="claims-nil">Nobody on the staff list yet. Add the first person above.</p>}
      {people.length > 0 && shown.length === 0 && <p className="claims-nil">Nobody matches.</p>}
      <ul className="pe-list">
        {shown.map((p) => {
          const isOpen = openId === p.id;
          const on = onJobs(p);
          return (
            <li key={p.id} className={`pe-row pe-row--${tone(p)}${isOpen ? ' pe-row--open' : ''}`}>
              <button type="button" className="pe-row__head" aria-expanded={isOpen} onClick={() => toggle(p)}>
                <span className="pe-avatar" aria-hidden>{initials(p.name)}</span>
                <span className="pe-row__who">
                  <span className="pe-row__name">{p.name}</span>
                  <span className="pe-row__role">{p.active ? (p.role ?? 'No role set') : `Was ${p.role ?? 'on the list'}`}{p.employer ? ` · ${p.employer}` : ''}</span>
                </span>
                <span className="pe-row__jobs">
                  {on.length ? on.map((j) => <span key={j.projectId} className="pe-jobtag">{j.code}</span>) : <span className="pe-row__nojob">Not on a job</span>}
                </span>
                <span className="pe-row__state">
                  {badges(p).map((b) => <span key={b.text} className={`pe-badge pe-badge--${b.tone}`}>{b.text}</span>)}
                </span>
                <span className="pe-row__chev" aria-hidden>{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && details && (
                <div className="pe-body">
                  <div className="pe-bar">
                    <nav className="pe-tabs" aria-label={`${p.name}: sections`}>
                      {([['jobs', 'Jobs', on.length], ['tickets', 'Tickets', p.tickets.length], ['login', 'Login', null], ['details', 'Details', null]] as const).map(([key, label, n]) => (
                        <button key={key} type="button" className={`pe-tab${tab === key ? ' pe-tab--on' : ''}${key === 'tickets' && (p.gaps.length || p.worst === 'expired') ? ' pe-tab--bad' : ''}${key === 'jobs' && p.notInducted.length ? ' pe-tab--warn' : ''}`} aria-pressed={tab === key} onClick={() => switchTab(key)}>
                          {label}{n != null ? <span className="pe-tab__n mono">{n}</span> : null}
                        </button>
                      ))}
                    </nav>
                    <div className="pe-bar__acts">
                      {p.active && !renaming && <button type="button" className="quotebtn" disabled={busy} onClick={() => { setRenaming(true); setNewName(p.name); setLeaving(false); setMsg(null); }}>Rename</button>}
                      {p.active && !leaving && <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => { setLeaving(true); setRenaming(false); setMsg(null); }}>Remove</button>}
                      {!p.active && <button type="button" className="quotebtn" disabled={busy} onClick={() => void setActive(p, true)}>Back with the company</button>}
                    </div>
                  </div>

                  {renaming && p.active && (
                    <div className="pe-note">
                      <p className="caption">The new name goes to {p.name}’s crew lists, tickets and inductions. Days already signed keep the name they were signed under and are added up with the new one on the timesheet.</p>
                      <div className="regs__fields">
                        <label className="fieldcell regs__field regs__field--wide"><span className="label">Their name, as it goes on the sheets</span>
                          <input className="field field--sm" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void rename(p); }} /></label>
                      </div>
                      {say('rename')}
                      <div className="regs__actions">
                        <button type="button" className="button button--quiet" disabled={busy || !newName.trim() || newName.trim() === p.name} onClick={() => void rename(p)}>{busy ? 'Renaming…' : 'Rename'}</button>
                        <button type="button" className="quotebtn" disabled={busy} onClick={() => { setRenaming(false); setNewName(''); setMsg(null); }}>Keep</button>
                      </div>
                    </div>
                  )}
                  {leaving && p.active && (
                    <div className="pe-note pe-note--bad">
                      <p className="caption">{p.name} comes off every job’s crew list and every job as a member, and their login is closed. They stay on the record: the tickets, inductions and every day already signed keep the name.</p>
                      <div className="regs__actions">
                        <button type="button" className="button button--quiet" disabled={busy} onClick={() => void setActive(p, false)}>Yes, they have left</button>
                        <button type="button" className="quotebtn" disabled={busy} onClick={() => setLeaving(false)}>Keep</button>
                      </div>
                    </div>
                  )}

                  {tab === 'jobs' && (
                    <div className="pe-panel">
                      <p className="caption pe-panel__lead">A tick puts them on that job’s crew list — what the diary, the prestart and the gate offer — and on the job as a member where they have a login.</p>
                      {jobs.length === 0 && <p className="caption">No active job on your account.</p>}
                      <div className="pe-jobs">
                        {p.jobs.map((j) => {
                          const job = jobOf(j.projectId);
                          const key = `${p.id}|${j.projectId}`;
                          const isOn = ticked[key] ?? j.onCrew;
                          return (
                            <div key={j.projectId} className={`pe-job${isOn ? ' pe-job--on' : ''}`}>
                              <label className="pe-job__tick">
                                <input type="checkbox" checked={isOn} disabled={busy || !p.active || !job?.canAssign} onChange={(e) => void setJob(p, j, e.target.checked)} />
                                <span className="pe-job__name"><b>{j.code}</b> {j.name}{j.jobRole ? <span className="caption"> · {j.jobRole} on this job</span> : null}</span>
                              </label>
                              <span className="pe-job__ind">
                                {j.inductedOn
                                  ? <span className="pe-badge pe-badge--ok">Inducted {fmtDate(j.inductedOn)}</span>
                                  : isOn ? <span className="pe-badge pe-badge--warn">Not inducted</span> : <span className="caption">Not inducted</span>}
                                {!j.inductedOn && job?.canAssign && inducting !== key && (
                                  <button type="button" className="quotebtn" disabled={busy} onClick={() => { setInducting(key); setInductDate(today); setInductNotes(''); setMsg(null); }}>Record induction</button>
                                )}
                              </span>
                              {j.inductedOn && j.inductionNotes ? <span className="caption pe-job__notes">{j.inductionNotes}</span> : null}
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
                      </div>
                      {say('jobs')}
                    </div>
                  )}

                  {tab === 'tickets' && (
                    <div className="pe-panel">
                      {p.gaps.length > 0 && <p className="pe-badge pe-badge--bad pe-badge--line">Their role needs, and they do not hold in date: {p.gaps.join(', ')}.</p>}
                      {p.tickets.length === 0 && <p className="caption">None recorded.</p>}
                      <div className="pe-tickets">
                        {p.tickets.map((t) => (
                          <div key={t.id} className={`pe-ticket pe-ticket--${t.state === 'expiring' ? 'warn' : t.state === 'expired' ? 'bad' : 'ok'}`}>
                            <span className="pe-ticket__what">
                              <b>{t.label}</b>
                              {t.ticketNo ? <span className="mono"> · {t.ticketNo}</span> : null}
                              <span className="pe-ticket__dates">
                                {t.issuedOn ? `Issued ${fmtDate(t.issuedOn)}` : 'No issue date'}
                                {t.expiresOn ? ` · ${t.state === 'expired' ? 'Expired' : 'Expires'} ${fmtDate(t.expiresOn)}` : ' · No expiry'}
                              </span>
                            </span>
                            <span className="pe-ticket__acts">
                              {t.photoPath && cards[t.photoPath] ? <a className="quotebtn" href={cards[t.photoPath]} target="_blank" rel="noopener">Card</a> : null}
                              <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => void retire(p, t.id, t.label)}>Remove</button>
                            </span>
                          </div>
                        ))}
                      </div>
                      {p.active && (
                        <div className={`pe-addticket${ticketDirty ? ' staff__unsaved' : ''}`} ref={ticketsRef}>
                          <p className="label">Add a ticket or certificate</p>
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
                          {ticket.photo && (
                            <div className="staff__card">
                              {preview ? <img src={preview} alt="The card as picked" className="staff__thumb" /> : null}
                              <span><b>{ticket.photo.name}</b><span className="caption"> · {(ticket.photo.size / 1048576).toFixed(1)} MB · picked, not saved yet</span></span>
                            </div>
                          )}
                          {ticketDirty && !(msg && msg.where === 'tickets') && <p className="staff__flag" role="status">Not saved yet — press Save ticket.</p>}
                          {say('tickets')}
                          <div className="regs__actions">
                            <label className="button button--quiet">
                              {ticket.photo ? 'Pick a different card' : 'Attach the card · photo or PDF'}
                              <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) { setTicket({ ...ticket, photo: f }); setMsg(null); } }} />
                            </label>
                            <button type="button" className={`button${ticketDirty ? '' : ' button--quiet'}`} disabled={busy} onClick={() => void addTicket(p)}>{busy ? 'Saving…' : ticket.photo ? 'Save ticket with its card' : 'Save ticket'}</button>
                            {ticketDirty && <button type="button" className="quotebtn" disabled={busy} onClick={() => { setTicket(BLANK_TICKET); setMsg(null); }}>Clear</button>}
                          </div>
                        </div>
                      )}
                      {!p.active && say('tickets')}
                    </div>
                  )}

                  {tab === 'login' && (
                    <div className="pe-panel">
                      {p.login ? (
                        <div className="staff__login">
                          <p className="caption">
                            Signs in as <span className="mono">{p.login.email ?? '—'}</span>
                            {p.login.closed ? <b className="staff__flag staff__flag--bad"> · account closed</b> : p.login.lastSignIn ? ` · last signed in ${fmtDate(p.login.lastSignIn.slice(0, 10))}` : ' · has not signed in yet'}
                          </p>
                          {p.login.memberships.length === 0 && <p className="caption">On no job as a member — tick a job under Jobs to put them on it.</p>}
                          {p.login.memberships.map((m) => {
                            const job = jobOf(m.projectId);
                            return (
                              <div key={m.projectId} className="staff__member">
                                <span className="pe-jobtag">{m.code}</span>
                                {job?.managesPeople && p.login!.userId !== userId && (job.isAdmin || m.role !== 'admin') ? (
                                  <select className="field field--sm staff__title" value={m.role} disabled={busy} onChange={(e) => void setTitle(p, m.projectId, e.target.value as MemberRole)} aria-label={`Title on ${m.code}`}>
                                    {ROLES.filter((r) => job.isAdmin || r !== 'admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                  </select>
                                ) : <span className="caption">{m.roleLabel}</span>}
                                {m.role === 'pm' && job?.isAdmin && p.login!.userId !== userId && (
                                  <label className="regs__tick"><input type="checkbox" checked={m.managesPeople} disabled={busy} onChange={(e) => void run('login', () => api('PATCH', `/api/projects/${m.projectId}/members`, { userId: p.login!.userId, managesPeople: e.target.checked }))} /><span>Manages people on {m.code}</span></label>
                                )}
                                {m.role === 'pm' && m.managesPeople && !job?.isAdmin && <span className="caption">· manages people</span>}
                              </div>
                            );
                          })}
                          {p.login.memberships.some((m) => jobOf(m.projectId)?.managesPeople) && p.login.userId !== userId && (
                            <div className="regs__actions">
                              {pwFor?.userId !== p.login.userId
                                ? <button type="button" className="quotebtn" disabled={busy} onClick={() => setPwFor({ userId: p.login!.userId, value: '' })}>Set a password</button>
                                : (
                                  <form className="signin__grid" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); void setPassword(p); }}>
                                    <label className="fieldcell"><span className="label">Their password · at least 8 characters</span>
                                      <input className="field field--sm" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus value={pwFor.value} onChange={(e) => setPwFor({ userId: p.login!.userId, value: e.target.value })} /></label>
                                    <button type="submit" className="button button--quiet" disabled={busy || pwFor.value.length < 8}>Set it</button>
                                    <button type="button" className="linklike" onClick={() => setPwFor(null)}>Cancel</button>
                                  </form>
                                )}
                              {codeEntered && p.login.memberships.some((m) => jobOf(m.projectId)?.isAdmin) && <button type="button" className="quotebtn" disabled={busy} onClick={() => void resetTwoFactor(p)}>Reset two-factor</button>}
                            </div>
                          )}
                          {p.login.memberships.some((m) => jobOf(m.projectId)?.isAdmin) && (
                            <Fold label="Advanced · money and screens" count={p.login.memberships.length}>
                              {p.login.memberships.filter((m) => jobOf(m.projectId)?.isAdmin).map((m) => (
                                <div key={m.projectId} className="item">
                                  <p className="label">{m.code}</p>
                                  <MoneyAccess member={memberRow(p, m)} canEdit={codeEntered && p.login!.userId !== userId} busy={busy}
                                    onSave={async (finance) => { try { await run('login', () => api('PATCH', `/api/projects/${m.projectId}/members`, { userId: p.login!.userId, finance })); return true; } catch { return false; } }}
                                    onReset={async () => { try { await run('login', () => api('PATCH', `/api/projects/${m.projectId}/members`, { userId: p.login!.userId, finance: null })); return true; } catch { return false; } }} />
                                  <AccessGrid member={memberRow(p, m)} canEdit={p.login!.userId !== userId} busy={busy}
                                    onSave={async (screens) => { try { await run('login', () => api('PATCH', `/api/projects/${m.projectId}/members`, { userId: p.login!.userId, screens })); return true; } catch { return false; } }} />
                                </div>
                              ))}
                            </Fold>
                          )}
                          {say('login')}
                        </div>
                      ) : p.active ? (
                        <div className="staff__login">
                          {!loginForm ? (
                            <p className="caption">No login yet. <button type="button" className="linklike" disabled={busy || !p.jobs.some((j) => j.onCrew && jobOf(j.projectId)?.managesPeople)} onClick={() => { setLoginForm({ email: '', password: '', title: 'labourer' }); try { const kept = window.localStorage.getItem(PW_KEY); if (kept) setLoginForm({ email: '', password: kept, title: 'labourer' }); } catch { /* no storage */ } }}>Give them a login</button>{!p.jobs.some((j) => j.onCrew) ? ' — put them on a job first, under Jobs.' : ''}</p>
                          ) : (
                            <div className="pe-note">
                              <div className="regs__fields">
                                <label className="fieldcell regs__field"><span className="label">Email · what they sign in with</span>
                                  <input className="field field--sm" type="email" autoCapitalize="none" autoComplete="off" inputMode="email" autoFocus value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} /></label>
                                <label className="fieldcell regs__field"><span className="label">Title in the app</span>
                                  <select className="field field--sm" value={loginForm.title} onChange={(e) => setLoginForm({ ...loginForm, title: e.target.value as MemberRole })}>
                                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                  </select></label>
                                <label className="fieldcell regs__field"><span className="label">Password · at least 8 characters</span>
                                  <input className="field field--sm" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Blank: they sign in by a link" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></label>
                              </div>
                              <p className="caption">They go on {p.jobs.filter((j) => j.onCrew).map((j) => j.code).join(', ')} as {ROLE_LABEL[loginForm.title]}. The password is told to them in person.</p>
                              {say('login')}
                              <div className="regs__actions">
                                <button type="button" className="button button--quiet" disabled={busy || !loginForm.email.trim()} onClick={() => void giveLogin(p)}>{busy ? 'Saving…' : 'Make their login'}</button>
                                <button type="button" className="quotebtn" disabled={busy} onClick={() => setLoginForm(null)}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : <p className="caption">No login.</p>}
                    </div>
                  )}

                  {tab === 'details' && (
                    <div className="pe-panel">
                      <div className="regs__fields">
                        <label className="fieldcell regs__field"><span className="label">Role</span>
                          <input className="field field--sm" list="staff-roles" value={details.role} onChange={(e) => setDetails({ ...details, role: e.target.value })} /></label>
                        <label className="fieldcell regs__field"><span className="label">Phone</span>
                          <input className="field field--sm" inputMode="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} /></label>
                        <label className="fieldcell regs__field"><span className="label">Employer, if not {orgName}</span>
                          <input className="field field--sm" value={details.employer} onChange={(e) => setDetails({ ...details, employer: e.target.value })} /></label>
                        <label className="fieldcell regs__field"><span className="label">Emergency contact</span>
                          <input className="field field--sm" placeholder="Name and number" value={details.emergency} onChange={(e) => setDetails({ ...details, emergency: e.target.value })} /></label>
                        <label className="fieldcell regs__field regs__field--wide"><span className="label">Notes</span>
                          <input className="field field--sm" value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} /></label>
                      </div>
                      <div className="regs__actions">
                        <button type="button" className="button button--quiet" disabled={busy} onClick={() => void saveDetails(p)}>{busy ? 'Saving…' : 'Save details'}</button>
                      </div>
                      {say('details')}
                      <p className="caption">The name is what the tickets, inductions and diaries are filed under — Rename, above, carries a new one through them.</p>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
