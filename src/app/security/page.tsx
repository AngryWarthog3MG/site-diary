import { Suspense } from 'react';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { requireUser } from '@/lib/auth';
import { seesMoney } from '@/lib/roles';
import { SecurityScreen } from './security-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security · Kooboolong IMS' };

const safeNext = (v: string | undefined) => (v && v.startsWith('/') && !v.startsWith('//') ? v : null);

/**
 * Two-factor sign-in (README R106). Anyone who sees the company's money signs in with a second step: a six-digit
 * code from an authenticator app. This is where it is set up, and removed.
 */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { memberships, aal } = await requireUser();
  const { next } = await searchParams;
  const entitled = memberships.some((m) => m.project.active && seesMoney(m));
  return (
    <main className="sheet">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> Your account</p>
      <h1 className="page-title">Two-factor sign-in</h1>
      <p className="page-subtitle">
        {entitled
          ? 'You see the company’s money on at least one job. The money opens only after a second step: a six-digit code from an authenticator app on your phone. The rest of the app works without it.'
          : 'You do not see the company’s money on any job, so you do not need this. You can still turn it on.'}
      </p>
      <SecurityScreen aal={aal} next={safeNext(next)} />
    </main>
  );
}
