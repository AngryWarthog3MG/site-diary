import Link from 'next/link';
import type { MoneyState } from '@/lib/auth';

/**
 * Where the money would be, for someone entitled to it whose session has not passed its code (README R106): one line
 * saying why it is shut and the one tap that opens it. Draws nothing for 'open' or 'none'.
 */
export function MoneyLock({ state, next, compact = false }: { state: MoneyState; next: string; compact?: boolean }) {
  if (state !== 'needs_code' && state !== 'needs_setup') return null;
  const href = state === 'needs_code' ? `/security/verify?next=${encodeURIComponent(next)}` : `/security?next=${encodeURIComponent(next)}`;
  return (
    <p className={`money-lock${compact ? ' money-lock--compact' : ''}`}>
      <svg className="money-lock__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
      <span>
        {state === 'needs_code'
          ? 'The money is hidden until you enter the code from your authenticator app.'
          : 'The money is hidden until you set up two-factor sign-in.'}{' '}
        <Link href={href}>{state === 'needs_code' ? 'Enter your code' : 'Set it up'}</Link>
      </span>
    </p>
  );
}
