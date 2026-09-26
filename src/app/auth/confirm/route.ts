import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Magic-link landing route.
 *
 * Handles both shapes Supabase can send:
 *   ?token_hash=…&type=…   the OTP-hash flow — works even when the link opens
 *                          in a different browser to the one that started it
 *   ?code=…                the PKCE flow — needs the verifier cookie
 *
 * Prefer the token_hash flow on site. To switch the mail over, set the
 * Magic Link email template to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');

  const nextParam = url.searchParams.get('next') ?? '/';
  // Only ever redirect to a path on this origin.
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const supabase = await createClient();

  // Someone with an authenticator set up is asked for their code straight after the email link (README R106).
  // They can go on without it; the money stays shut until they give it.
  const landing = async () => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        return NextResponse.redirect(new URL(`/security/verify?next=${encodeURIComponent(next)}`, url.origin));
      }
    } catch {
      // A failed check is the email link alone: the money stays shut, the rest opens.
    }
    return NextResponse.redirect(new URL(next, url.origin));
  };

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return landing();
    }
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return landing();
    }
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(
    new URL('/login?error=That+link+is+not+valid.+Ask+for+a+new+one.', url.origin),
  );
}
