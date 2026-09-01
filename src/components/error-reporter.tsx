'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * When a phone on site hits a JavaScript error, the operator finds out from
 * the nightly ops digest instead of a phone call. One-way telemetry: capped
 * fields, at most five reports per page load, silently dropped when offline
 * or signed out — an error reporter must never cause errors.
 */
export function ErrorReporter() {
  useEffect(() => {
    let budget = 5;

    const report = (message: string, stack?: string | null) => {
      if (budget <= 0 || typeof navigator !== 'undefined' && !navigator.onLine) return;
      budget -= 1;
      void (async () => {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          if (!data.user) return;
          await supabase.from('client_errors').insert({
            user_id: data.user.id,
            path: window.location.pathname.slice(0, 300),
            message: message.slice(0, 1000),
            stack: stack?.slice(0, 4000) ?? null,
            user_agent: navigator.userAgent.slice(0, 300),
          });
        } catch {
          // Deliberately swallowed.
        }
      })();
    };

    const onError = (event: ErrorEvent) => {
      report(event.message || 'Unknown error', event.error?.stack ?? null);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(
        reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection'),
        reason instanceof Error ? (reason.stack ?? null) : null,
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
