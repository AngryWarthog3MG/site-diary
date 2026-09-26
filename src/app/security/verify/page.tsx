import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { requireUser } from '@/lib/auth';
import { VerifyCode } from './verify-code';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your code · Kooboolong IMS' };

const safeNext = (v: string | undefined) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/');

/**
 * The second step (README R106), straight after the email link for anyone with an authenticator set up. The code
 * opens the money; "Not now" carries on without it.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { aal } = await requireUser();
  const next = safeNext((await searchParams).next);
  if (aal.current === 'aal2') redirect(next);
  if (aal.next !== 'aal2') redirect(`/security?next=${encodeURIComponent(next)}`);
  return (
    <main className="sheet sheet--narrow">
      <p className="label"><BrandMark size={18} /> Kooboolong IMS</p>
      <h1 className="page-title">Enter your code</h1>
      <p className="page-subtitle">The six digits your authenticator app shows for Kooboolong IMS. They change every 30 seconds.</p>
      <VerifyCode next={next} />
    </main>
  );
}
