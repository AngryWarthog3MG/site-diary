'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRole } from '@/types/database';

export interface MemberRow {
  userId: string;
  role: MemberRole;
  /** Exactly the screens ticked for this person; null = the role's own list. */
  screens: string[] | null;
  /** Money access; null = the role's default (README R105). */
  finance: boolean | null;
  /** Two-factor set up (README R106); null when not loaded (a non-admin's view). */
  twoFactor: boolean | null;
  name: string | null;
  email: string | null;
  isCurrentUser: boolean;
}

import { ROLES, ROLE_HINT as ROLE_TEXT, ROLE_LABEL, defaultScreens, grantableScreens, seesMoney, type Screen } from '@/lib/roles';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { NAV_GROUPS } from '@/lib/nav';

/**
 * One tick box per screen, under the headings the menu uses. Unticked is
 * refused, not hidden — the middleware, the page and the APIs all read the
 * same list. Each tick saves at once; "Back to the role's list" clears them.
 */
function AccessGrid({ member, canEdit, busy, onSave }: { member: MemberRow; canEdit: boolean; busy: boolean; onSave: (screens: string[] | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const grantable = grantableScreens(member.role);
  const ticked = new Set(member.screens ?? defaultScreens(member.role));
  const custom = member.screens !== null;
  const groups = NAV_GROUPS.map((g) => ({ label: g.scope === 'company' ? `Company · ${g.label}` : g.label, items: g.items.filter((it) => it.screen && grantable.includes(it.screen)) })).filter((g) => g.items.length > 0);
  const toggle = (screen: Screen) => {
    const next = new Set(ticked);
    if (next.has(screen)) next.delete(screen); else next.add(screen);
    void onSave(grantable.filter((s) => next.has(s)));
  };
  const count = grantable.filter((s) => ticked.has(s)).length;
  return (
    <div className="access">
      <button type="button" className="access__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="access__title">Access</span>
        <span className="access__sum">{count} of {grantable.length} screens{custom ? ' · set by hand' : ' · the role’s list'}</span>
        <span className="access__caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="access__body">
          {groups.map((g) => (
            <div key={g.label} className="access__group">
              <p className="label">{g.label}</p>
              {g.items.map((it) => {
                const screen = it.screen as Screen;
                const forced = member.role === 'admin' && screen === 'settings';
                return (
                  <label key={screen} className={`checkrow checkrow--inline${ticked.has(screen) ? ' checkrow--on' : ''}`}>
                    <input type="checkbox" checked={ticked.has(screen) || forced} disabled={!canEdit || busy || forced} onChange={() => toggle(screen)} />
                    <span>{it.name}{forced ? ' — an admin always keeps this' : ''}</span>
                  </label>
                );
              })}
            </div>
          ))}
          {canEdit && custom && (
            <button type="button" className="linklike" disabled={busy} onClick={() => void onSave(null)}>Back to the {ROLE_LABEL[member.role].toLowerCase()}’s own list</button>
          )}
          {member.role === 'labourer' && <p className="caption">A labourer can hold these two and nothing more — the record is closed to them whatever is ticked.</p>}
        </div>
      )}
    </div>
  );
}

/** The member's name as the sheets print it; an admin can set it. */
function NameLine({ member, canEdit, busy, onSave }: { member: MemberRow; canEdit: boolean; busy: boolean; onSave: (name: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.name ?? '');
  return (
    <>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {member.name ?? <span className="vr-missing">No name yet — sheets would show their email</span>}
        {member.isCurrentUser ? ' · you' : ''}
      </p>
      {canEdit && !editing && (
        <button type="button" className="linklike" disabled={busy} onClick={() => { setValue(member.name ?? ''); setEditing(true); }}>
          {member.name ? 'Change name' : 'Set their name'}
        </button>
      )}
      {editing && (
        <form
          className="signin__grid"
          style={{ alignItems: 'end', margin: '0.25rem 0' }}
          onSubmit={(e) => { e.preventDefault(); void onSave(value).then((saved) => { if (saved) setEditing(false); }); }}
        >
          <label className="fieldcell">
            <span className="label">Name on the sheets</span>
            <input id={`member-name-${member.userId}`} className="field field--sm" autoCapitalize="words" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button type="submit" className="button button--quiet" disabled={busy || !value.trim()}>Save</button>
          <button type="button" className="linklike" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
    </>
  );
}

export function MembersForm({
  projectId,
  projectRef,
  canEdit,
  members,
  codeEntered = false,
}: {
  projectId: string;
  projectRef: string;
  canEdit: boolean;
  members: MemberRow[];
  /** Whether this admin's session has passed its two-factor code — granting money needs it (README R106). */
  codeEntered?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('supervisor');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const adminCount = useMemo(
    () => members.filter((member) => member.role === 'admin').length,
    [members],
  );

  async function request(method: string, body: object, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json?.error?.message ?? 'That change did not save.');
        return false;
      }
      setNotice(json?.message ?? 'Saved.');
      router.refresh();
      return true;
    } catch {
      setError('No signal.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function resetTwoFactor(targetId: string) {
    setBusy(`2fa:${targetId}`); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/two-factor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targetId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error?.message ?? 'That did not work.'); return false; }
      setNotice(json?.message ?? 'Done.'); router.refresh(); return true;
    } catch { setError('No signal.'); return false; }
    finally { setBusy(null); }
  }

  async function addMember() {
    const added = await request('POST', { email, name, role }, 'add');
    if (added) { setEmail(''); setName(''); }
  }

  return (
    <>
      {!canEdit && (
        <p className="notice">
          You can see who is on this project. Only an admin can change membership.
        </p>
      )}

      {canEdit && !codeEntered && (
        <p className="money-lock">
          <span>Giving someone the money, or making someone a PM or admin, needs your two-factor code. <a href={`/security/verify?next=${encodeURIComponent(`/settings/members?project=${projectId}`)}`}>Enter it</a> or <a href="/security">set it up</a>.</span>
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <p className="label">Current members</p>
      {members.length === 0 ? (
        <p style={{ color: 'var(--ink-40)' }}>No members found.</p>
      ) : (
        <div className="memberlist">
          {members.map((member) => {
            const isOnlyAdmin = member.role === 'admin' && adminCount === 1;
            const locked = !canEdit || member.isCurrentUser || isOnlyAdmin;
            return (
              <article key={member.userId} className="member">
                <div>
                  <NameLine
                    member={member}
                    canEdit={canEdit}
                    busy={busy !== null}
                    onSave={(name) => request('PATCH', { userId: member.userId, name }, `name:${member.userId}`)}
                  />
                  <p className="mono" style={{ margin: '0.125rem 0 0', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
                    {member.email ?? member.userId}
                  </p>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
                    {ROLE_TEXT[member.role]}
                  </p>
                </div>

                <div className="member__actions">
                  <label>
                    <span className="label">Role</span>
                    <select
                      className="field field--sm"
                      value={member.role}
                      disabled={locked || busy !== null}
                      onChange={(event) =>
                        void request(
                          'PATCH',
                          { userId: member.userId, role: event.target.value },
                          `role:${member.userId}`,
                        )
                      }
                    >
                      {ROLES.map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABEL[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canEdit && (
                    <button
                      type="button"
                      className="quotebtn quotebtn--remove"
                      disabled={locked || busy !== null}
                      onClick={() =>
                        void request('DELETE', { userId: member.userId }, `remove:${member.userId}`)
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <AccessGrid
                  member={member}
                  canEdit={canEdit}
                  busy={busy !== null}
                  onSave={(screens) => request('PATCH', { userId: member.userId, screens }, `access:${member.userId}`)}
                />
                <MoneyAccess
                  member={member}
                  canEdit={canEdit}
                  busy={busy !== null}
                  onSave={(finance) => request('PATCH', { userId: member.userId, finance }, `money:${member.userId}`)}
                  onReset={() => resetTwoFactor(member.userId)}
                />
              </article>
            );
          })}
        </div>
      )}

      {canEdit && (
        <>
          <hr className="rule" />
          <p className="label">Add someone</p>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
            Their email and their title. They open the app, type that email, tap the link that comes back, and they are in — nothing to send, no password, no sign-up.
          </p>
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Email</span>
            <input
              className="field field--sm"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
            />
          </label>
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Title</span>
            <select
              className="field field--sm"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Name (optional — it prints on the sheets)</span>
            <input
              className="field field--sm"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="If you leave it, they are asked once"
            />
          </label>
          <button
            className="button"
            type="button"
            disabled={busy !== null || !email.trim()}
            onClick={() => void addMember()}
          >
            {busy === 'add' ? 'Adding...' : 'Add them'}
          </button>
        </>
      )}
    </>
  );
}

/**
 * The money switch (README R105). Money is its own permission, apart from the screens: variation values, rates,
 * cost build-ups and the company's figures. An admin always sees it; a PM does unless switched off; a supervisor
 * does not unless switched on; a leading hand or labourer never does. The database enforces the same rule.
 */
function MoneyAccess({ member, canEdit, busy, onSave, onReset }: { member: MemberRow; canEdit: boolean; busy: boolean; onSave: (finance: boolean | null) => Promise<boolean>; onReset: () => Promise<boolean> }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const on = seesMoney(member);
  const settable = member.role === 'pm' || member.role === 'supervisor';
  const byHand = settable && member.finance !== null;
  const why = member.role === 'admin' ? 'an admin always does'
    : !settable ? `a ${ROLE_LABEL[member.role].toLowerCase()} never does`
    : byHand ? 'set by hand' : `the ${ROLE_LABEL[member.role].toLowerCase()}’s default`;
  return (
    <div className="money-access">
      <span className="money-access__state">
        <span className={`money-access__dot${on ? ' money-access__dot--on' : ''}`} aria-hidden />
        <strong>{on ? 'Sees the money' : 'Money hidden'}</strong>
        <span className="caption"> · {why}</span>
        {member.twoFactor !== null && (on || member.twoFactor) && (
          <span className={`caption money-access__2fa${on && !member.twoFactor ? ' money-access__2fa--missing' : ''}`}> · two-factor {member.twoFactor ? 'on' : 'not set up — the money stays shut for them'}</span>
        )}
      </span>
      {canEdit && settable && (
        <span className="money-access__act">
          <button type="button" className="quotebtn" disabled={busy} onClick={() => void onSave(!on)}>{on ? 'Hide the money' : 'Show the money'}</button>
          {byHand && <button type="button" className="quotebtn" disabled={busy} onClick={() => void onSave(null)}>Back to the default</button>}
        </span>
      )}
      {canEdit && member.twoFactor && !member.isCurrentUser && (
        <span className="money-access__act">
          {confirmReset
            ? <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => void onReset().then(() => setConfirmReset(false))}>Sure? Reset their two-factor</button>
            : <button type="button" className="quotebtn" disabled={busy} onClick={() => setConfirmReset(true)}>Lost phone? Reset two-factor</button>}
        </span>
      )}
    </div>
  );
}

export interface AccessEvent {
  id: string;
  who: string;
  by: string;
  at: string;
  kind: 'added' | 'changed' | 'removed' | 'two_factor_reset';
  oldRole: string | null;
  newRole: string | null;
  moneyBefore: boolean;
  moneyAfter: boolean;
  screensChanged: boolean;
}

const roleWord = (r: string | null) => (r && r in ROLE_LABEL ? ROLE_LABEL[r as MemberRole] : r ?? '');

/** Who changed whose access on this job, and when — the record an access review reads (README R105). Admins only. */
export function AccessHistory({ events }: { events: AccessEvent[] }) {
  if (events.length === 0) return null;
  const say = (e: AccessEvent) => {
    if (e.kind === 'added') return `added as ${roleWord(e.newRole)}${e.moneyAfter ? ', sees the money' : ''}`;
    if (e.kind === 'removed') return `removed (was ${roleWord(e.oldRole)})`;
    if (e.kind === 'two_factor_reset') return 'two-factor reset';
    const parts: string[] = [];
    if (e.oldRole !== e.newRole) parts.push(`${roleWord(e.oldRole)} → ${roleWord(e.newRole)}`);
    if (e.moneyBefore !== e.moneyAfter) parts.push(e.moneyAfter ? 'money shown' : 'money hidden');
    if (e.screensChanged) parts.push('screens changed');
    return parts.join(' · ') || 'access changed';
  };
  return (
    <details className="access-history">
      <summary>Access history · last {events.length}</summary>
      <ul className="plainlist">
        {events.map((e) => (
          <li key={e.id}><span className="mono">{fmtPerthDate(e.at)}</span> <strong>{e.who}</strong> {say(e)} <span className="caption">— by {e.by}</span></li>
        ))}
      </ul>
    </details>
  );
}
