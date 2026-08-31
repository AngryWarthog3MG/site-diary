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

const ROLES: MemberRole[] = ['supervisor', 'pm', 'admin'];
const ROLE_TEXT: Record<MemberRole, string> = {
  supervisor: 'Can record and sign their own entries',
  pm: 'Read-only project access',
  admin: 'Can record, sign, and manage this project',
};

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
                          {option}
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
                  {option}
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
          <p className="label">QR rollout</p>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-60)', fontSize: '0.875rem' }}>
            Generate sign-in cards from your terminal after members are seated.
          </p>
          <pre className="sql">{`npm run signin -- --project ${projectRef} --qr-pack`}</pre>
          <pre className="sql">{`npm run signin -- --project ${projectRef} --qr-pack --role supervisor`}</pre>
        </>
      )}
    </>
  );
}
