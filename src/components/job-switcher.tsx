'use client';

import { usePathname, useRouter } from 'next/navigation';
import { navPending } from '@/components/nav-progress';
import { JOB_COOKIE, onJob, switchTarget } from '@/lib/jobs';

export interface SwitchableJob { id: string; name: string; code: string; org?: { name: string; code: string } }

/**
 * The job you are looking at, and the way to another (README R87). One job:
 * just its name. More: a picker that keeps the section you are in, drops any
 * detail page (a day belongs to one job), and remembers the choice in a
 * cookie so every screen after this opens on it — the middleware writes the
 * same cookie from `?project=`, so a link and a pick agree.
 *
 * Across companies the code alone can mislead (two jobs numbered 001), so the
 * company is named with the job whenever the jobs span more than one.
 */
export function JobSwitcher({ jobs, currentId, compact = false }: { jobs: SwitchableJob[]; currentId: string | null; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = jobs.find((j) => j.id === currentId) ?? null;
  const companies = new Set(jobs.map((j) => j.org?.code ?? ''));
  const label = (j: SwitchableJob) => (companies.size > 1 && j.org ? `${j.name} · ${j.code} · ${j.org.name}` : `${j.name} · ${j.code}`);

  if (jobs.length <= 1) {
    if (!current) return null;
    return (
      <div className={`jobswitch${compact ? ' jobswitch--compact' : ''}`}>
        <span className="label">Job</span>
        <span className="jobswitch__name">{current.name}</span>
        <span className="mono jobswitch__code">{current.code}</span>
      </div>
    );
  }

  return (
    <label className={`jobswitch${compact ? ' jobswitch--compact' : ''}`}>
      <span className="label">Job</span>
      <select
        className="field field--sm jobswitch__select"
        value={current?.id ?? ''}
        aria-label="Which job you are looking at"
        onChange={(e) => {
          const id = e.target.value;
          if (!id || id === current?.id) return;
          try {
            document.cookie = `${JOB_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
          } catch {
            // No cookie jar (a private tab that refuses): the address still names the job.
          }
          navPending.start();
          router.push(onJob(switchTarget(pathname), id));
        }}
      >
        {!current && <option value="">Pick a job…</option>}
        {jobs.map((j) => <option key={j.id} value={j.id}>{label(j)}</option>)}
      </select>
    </label>
  );
}
