'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as outbox from '@/lib/outbox/store';
import { fmtDate } from '@/lib/pdf/dates';

/** Prestarts made with no signal and not yet sent: open one to keep signing the crew on. */
export function LocalPrestarts({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; date: string; supervisor: string }>>([]);
  useEffect(() => {
    const load = async () => {
      const items = await outbox.all();
      setRows(items.filter((i) => i.kind === 'prestart_create' && i.projectId === projectId).map((i) => {
        const row = i.payload.row as Record<string, unknown>;
        return { id: i.subjectId, date: String(row.prestart_date), supervisor: String(row.supervisor_name) };
      }));
    };
    void load();
    return outbox.onOutboxChange(() => void load());
  }, [projectId]);
  if (rows.length === 0) return null;
  return (
    <ul className="register-list" style={{ marginBottom: '0.75rem' }}>
      {rows.map((r) => (
        <li key={r.id}>
          <Link className="register-card" href={`/prestart/new?project=${projectId}&local=${r.id}`}>
            <div className="register-card__main">
              <p className="register-card__title">{fmtDate(r.date)}</p>
              <p className="register-card__meta">Run by {r.supervisor} · on this phone, not yet sent</p>
            </div>
            <span className="status-pill status-pill--gap">Open</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
