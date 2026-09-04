export const dynamic = 'force-dynamic';

/**
 * Which build is live. The client compares this with the build it was served
 * with; a mismatch means the phone is running an old copy of the app.
 */
export function GET() {
  return Response.json(
    { build: process.env.VERCEL_DEPLOYMENT_ID ?? 'dev' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
