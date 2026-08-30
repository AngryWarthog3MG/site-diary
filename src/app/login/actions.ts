'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';

export interface LoginState {
  stage: 'email' | 'code';
  email: string;
  error: string | null;
  notice: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Step one: send a magic link. The same mail carries a six-digit code, which
 * is the fallback when the link opens in a different browser to the one the
 * supervisor started in — common on a phone, where mail apps use their own
 * in-app browser and the PKCE verifier cookie is not there.
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const next = String(formData.get('next') ?? '/');

  if (!EMAIL_RE.test(email)) {
    return { stage: 'email', email, error: 'Enter a valid email address.', notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { stage: 'email', email, error: error.message, notice: null };
  }

  return {
    stage: 'code',
    email,
    error: null,
    notice: `Sent to ${email}. Open the link, or key in the six-digit code.`,
  };
}

/** Step two (fallback): verify the six-digit code from the same email. */
export async function verifyCode(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').replace(/\D/g, '');
  const next = String(formData.get('next') ?? '/');

  if (token.length !== 6) {
    return { stage: 'code', email, error: 'The code is six digits.', notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

  if (error) {
    return { stage: 'code', email, error: error.message, notice: null };
  }

  redirect(next.startsWith('/') ? next : '/');
}
