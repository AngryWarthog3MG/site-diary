/**
 * Which job you are looking at, and how that sticks (README R87).
 *
 * Every screen resolves its job the same way: the `?project=` the address
 * names, else the first active membership. With one job that was invisible;
 * with several it meant the app forgot your choice the moment a link dropped
 * the parameter. So the job you pick is kept in a cookie, and the memberships
 * are handed to every screen with that job FIRST — the pages keep asking for
 * "the first one" and get the one you chose, without sixty call sites
 * learning about cookies.
 *
 * The cookie is a preference, not a credential: `preferJob` only ever moves a
 * membership the account actually holds, so a stale or forged id changes
 * nothing. Pure, relative imports only — node-tested.
 */
import { HOME_ITEM, NAV_GROUPS } from './nav.ts';

export const JOB_COOKIE = 'kbl-job';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cookie value worth acting on. Anything else is ignored, never trusted. */
export function readJobCookie(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/**
 * The same memberships, with the preferred job first. An id the account is
 * not on, or that names a job asleep, leaves the order exactly as it was.
 */
export function preferJob<T extends { project_id: string; project: { active: boolean } }>(memberships: readonly T[], jobId: string | null | undefined): T[] {
  const list = memberships.slice();
  if (!jobId) return list;
  const i = list.findIndex((m) => m.project_id === jobId && m.project.active);
  if (i <= 0) return list;
  const [chosen] = list.splice(i, 1);
  list.unshift(chosen);
  return list;
}

/**
 * Where a job switch lands you: the section you were in, on the new job. A
 * detail page belongs to one job — the day, the lot, the incident it names —
 * so switching from `/entries/<id>/review` goes to `/entries`, not to the same
 * day on a job that never had it. The longest section address that prefixes
 * the path wins, so `/quality/equipment` stays put and `/quality/lot/<id>`
 * goes to `/quality`. Somewhere the sections do not cover goes Home.
 */
export function switchTarget(pathname: string): string {
  const roots = [HOME_ITEM.href, ...NAV_GROUPS.flatMap((g) => g.items.map((it) => it.href))];
  const clean = pathname.replace(/\/+$/, '') || '/';
  let best = '/';
  for (const root of roots) {
    if (root === '/') continue;
    if ((clean === root || clean.startsWith(`${root}/`)) && root.length > best.length) best = root;
  }
  return best;
}

/** The address for a screen on a job. `/portfolio` is every job at once and takes none. */
export function onJob(href: string, jobId: string | null | undefined): string {
  if (!jobId || href === '/portfolio') return href;
  return `${href}?project=${jobId}`;
}
