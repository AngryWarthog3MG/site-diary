import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { DUE_LABEL } from '@/lib/documents-control/model';
import { loadWaitingOnMe } from '@/lib/documents-control/load';

/**
 * Waiting on you (README R120): the documents this person must read and sign,
 * soonest first, on the home of every role. Drawn only when there is
 * something; silence means nothing is waiting.
 */
export async function WaitingPanel({ userId, projectId }: { userId: string; projectId: string }) {
  const supabase = await createClient();
  const items = await loadWaitingOnMe(supabase, userId, perthToday());
  if (items.length === 0) return null;
  const overdue = items.filter((i) => i.state === 'overdue').length;
  return (
    <section className="waiting" aria-label="Waiting on you">
      <div className="waiting__head">
        <p className="label">Waiting on you · {items.length}</p>
        {overdue > 0 && <span className="status-pill status-pill--danger">{overdue} overdue</span>}
      </div>
      <ul className="waiting__list">
        {items.map((i) => (
          <li key={i.id}>
            <Link className={`waiting__item${i.state === 'overdue' ? ' waiting__item--overdue' : ''}`} href={`/procedures/${i.documentId}?project=${projectId}`}>
              <span className="waiting__text">
                <span className="waiting__title">{i.title} · v{i.version}</span>
                <span className="caption">Read and sign{i.questions ? ', with questions' : ''} · {i.state === 'overdue' ? `was due ${fmtDate(i.due_on)}` : `by ${fmtDate(i.due_on)}`}</span>
              </span>
              <span className="waiting__cta">{i.state === 'overdue' ? DUE_LABEL.overdue : 'Sign'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
