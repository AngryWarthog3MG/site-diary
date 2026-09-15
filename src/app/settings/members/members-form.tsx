'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRole } from '@/types/database';

export interface MemberRow {
  userId: string;
  role: MemberRole;
  name: string | null;
  email: string | null;
  isCurrentUser: boolean;
}

import { ROLES, ROLE_HINT as ROLE_TEXT, ROLE_LABEL } from '@/lib/roles';

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
