'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendMagicLink, verifyCode, type LoginState } from './actions';

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'Sending…' : children}
    </button>
  );
}

/**
 * Whether a six-digit code can actually arrive.
 *
 * Supabase's built-in mail provider sends its own stock template, which carries
 * a link and no code, and free-tier projects cannot replace that template. So
 * offering a code box means offering somewhere to type a number that is never
 * sent — which reads as the app being broken rather than the mail being
 * limited.
 *
 * The template that sends a code is written and wired up in config.toml; it
 * needs custom SMTP. Set NEXT_PUBLIC_EMAIL_OTP=1 once that is configured.
 */
const CODE_ENABLED = process.env.NEXT_PUBLIC_EMAIL_OTP === '1';

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const initial: LoginState = {
    stage: 'email',
    email: '',
    error: initialError ?? null,
    notice: null,
  };

  const [emailState, sendAction] = useActionState<LoginState, FormData>(
    sendMagicLink,
    initial,
  );
  const [codeState, verifyAction] = useActionState<LoginState, FormData>(verifyCode, {
    ...initial,
    stage: 'code',
  });

  // Once the link is away, keep the resend form; show the code fallback only
  // where a code is actually sent.
  const sent = emailState.stage === 'code';

  return (
    <>
      <form action={sendAction}>
        <input type="hidden" name="next" value={next} />
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="field"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={emailState.email}
          placeholder="you@example.com"
        />
        <Submit>{sent ? 'Send again' : 'Send link'}</Submit>
      </form>

      {emailState.error && <p className="alert">{emailState.error}</p>}
      {emailState.notice && <p className="notice">{emailState.notice}</p>}

      {sent && CODE_ENABLED && (
        <>
          <hr className="rule" />
          <form action={verifyAction}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="email" value={emailState.email} />
            <label className="label" htmlFor="token">
              Or key in the code
            </label>
            <input
              id="token"
              name="token"
              type="text"
              className="field mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder="000000"
            />
            <Submit>Sign in</Submit>
          </form>
          {codeState.error && <p className="alert">{codeState.error}</p>}
        </>
      )}

      {sent && !CODE_ENABLED && (
        <p className="notice">
          Open the link on the phone you record on. It expires shortly, and it only works
          once. For site rollout, use the QR from your admin instead of forwarding emails
          around.
        </p>
      )}
    </>
  );
}
