/**
 * The job in hand, remembered on the phone. Lists and Home carry `?project=`;
 * detail screens (a prestart, an incident, a permit) do not, so a Home button
 * on one would otherwise fall back to whichever job the account lists first.
 * The last job seen in a URL is kept for the session; browser storage can be
 * absent or refuse, so every touch is guarded and the fallback is plain Home.
 */
const KEY = 'site-diary-project';

export function rememberProject(id: string | null | undefined): void {
  if (!id) return;
  try { window.sessionStorage.setItem(KEY, id); } catch { /* no storage: nothing to remember with */ }
}

export function recallProject(): string | null {
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

/** Home for this job: the URL's project first, the remembered one second, plain Home last. */
export function homeHref(fromUrl: string | null, remembered: string | null): string {
  const id = fromUrl ?? remembered;
  return id ? `/?project=${id}` : '/';
}
