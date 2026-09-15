'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRole } from '@/types/database';

export interface MemberRow {
  userId: string;
  role: MemberRole;
  /** Exactly the screens ticked for this person; null = the role's own list. */
  screens: string[] | null;
  name: string | null;
  email: string | null;
  isCurrentUser: boolean;
}

import { ROLES, ROLE_HINT as ROLE_TEXT, ROLE_LABEL, defaultScreens, grantableScreens, type Screen } from '@/lib/roles';
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
  const groups = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((it) => it.screen && grantable.includes(it.screen)) })).filter((g) => g.items.length > 0);
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

export function MembersForm({
  projectId,
  projectRef,
  canEdit,
  members,
}: {
  projectId: string;
  projectRef: string;
  canEdit: boolean;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('supervisor');
  const [lines, setLines] = useState('');
  const [bulkRole, setBulkRole] = useState<MemberRole>('labourer');
  const [bulk, setBulk] = useState<null | { added: number; results: Array<{ email: string; name: string | null; outcome: string; detail?: string }> }>(null);
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

  async function addSeveral() {
    setBusy('bulk');
    try {
      const res = await fetch(`/api/projects/${projectId}/members/bulk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, role: bulkRole }) });
      const json = (await res.json().catch(() => null)) as { added?: number; results?: Array<{ email: string; name: string | null; outcome: string; detail?: string }>; error?: { message?: string } } | null;
      if (!res.ok || !json?.results) { setNotice(json?.error?.message ?? 'That did not save.'); return; }
      setBulk({ added: json.added ?? 0, results: json.results });
      setLines('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addMember() {
    const added = await request('POST', { email, role }, 'add');
    if (added) setEmail('');
  }

  return (
    <>
      {!canEdit && (
        <p className="notice">
          You can see who is on this project. Only an admin can change membership.
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
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {member.name ?? member.email ?? 'Unnamed member'}
                    {member.isCurrentUser ? ' · you' : ''}
                  </p>
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
              </article>
            );
          })}
        </div>
      )}

      {canEdit && (
        <>
          <hr className="rule" />
          <p className="label">Add member</p>
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
            <span className="label">Role</span>
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
          <button
            className="button"
            type="button"
            disabled={busy !== null || !email.trim()}
            onClick={() => void addMember()}
          >
            {busy === 'add' ? 'Adding...' : 'Add member'}
          </button>

          <hr className="rule" />
          <p className="label">Add several at once</p>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
            One person per line — a name and an email address. Anyone without an account gets one; anyone already on the job is left as they are.
          </p>
          <textarea className="field field--sm" rows={6} value={lines} placeholder={'Sam Nguyen sam@example.com\nPriya Patel <priya@example.com>\ndanny@example.com'} onChange={(e) => setLines(e.target.value)} />
          <label className="fieldcell" style={{ marginTop: '0.75rem' }}>
            <span className="label">Role for everyone on the list</span>
            <select className="field field--sm" value={bulkRole} onChange={(e) => setBulkRole(e.target.value as MemberRole)}>
              {ROLES.map((option) => <option key={option} value={option}>{ROLE_LABEL[option]}</option>)}
            </select>
          </label>
          <button className="button" type="button" disabled={busy !== null || !lines.trim()} onClick={() => void addSeveral()}>
            {busy === 'bulk' ? 'Adding…' : 'Add everyone on the list'}
          </button>
          {bulk && (
            <div className="notice" style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: 0 }}><strong>{bulk.added}</strong> added as {ROLE_LABEL[bulkRole].toLowerCase()}{bulk.added === 1 ? '' : 's'}.</p>
              <ul className="gaplist">
                {bulk.results.map((r) => (
                  <li key={r.email}>{r.name ? `${r.name} · ` : ''}{r.email} — {r.outcome === 'added' ? 'added' : r.outcome === 'already' ? `already on the job as ${r.detail}` : r.outcome === 'invalid' ? 'not an email address' : `failed: ${r.detail}`}</li>
                ))}
              </ul>
            </div>
          )}

          <hr className="rule" />
          <p className="label">Sign-in cards</p>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
            One printable card per person with a QR code that signs them in. Each code works once and expires in about
            an hour, so print the pack with the crew in front of you.
          </p>
          <div className="photo-add-pair" style={{ marginTop: '0.5rem' }}>
            <a className="button button--quiet" style={{ marginTop: 0 }} href={`/settings/members/cards?project=${projectId}&role=labourer`} target="_blank" rel="noopener">Cards for labourers</a>
            <a className="button button--quiet" style={{ marginTop: 0 }} href={`/settings/members/cards?project=${projectId}`} target="_blank" rel="noopener">Cards for everyone</a>
          </div>
          <p className="caption" style={{ marginTop: '0.5rem' }}>From a terminal: <code>npm run signin -- --project {projectRef} --qr-pack --role labourer</code></p>
        </>
      )}
    </>
  );
}
