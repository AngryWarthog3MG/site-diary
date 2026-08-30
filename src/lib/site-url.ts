/**
 * Where this deployment lives.
 *
 * The magic link has to come back to the host the supervisor is actually on,
 * which is not knowable at build time on a platform that mints the hostname
 * for you. So: an explicit setting wins, the platform's own answer is the
 * fallback, and localhost is the last resort for development.
 *
 * Server-side only — `VERCEL_PROJECT_PRODUCTION_URL` is not a NEXT_PUBLIC_
 * variable and is never inlined into a browser bundle.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}
