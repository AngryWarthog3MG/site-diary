'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendMagicLink, signInWithPassword, verifyCode, type LoginState } from './actions';

function Submit({ children, quiet, formAction, busyText }: { children: string; quiet?: boolean; formAction?: (formData: FormData) => void; busyText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={`button${quiet ? ' button--quiet' : ''}`} type="submit" disabled={pending} formAction={formAction}>
      {pending ? (busyText ?? 'Sending…') : children}
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
  // Email and password (README R146): the crew's way in. The same form sends a link instead.
  const [pwState, passwordAction] = useActionState<LoginState, FormData>(signInWithPassword, initial);

  // Once the link is away, keep the resend form; show the code fallback only
  // where a code is actually sent.
  const sent = emailState.stage === 'code';

  return (
    <>
      <form action={passwordAction}>
        <input type="hidden" name="next" value={next} />
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="field"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={pwState.email || emailState.email}
          placeholder="you@example.com"
        />
        <label className="label" htmlFor="password" style={{ marginTop: '0.75rem' }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete="current-password"
          placeholder="The password the office gave you"
        />
        <Submit busyText="Signing in…">Sign in</Submit>
        <p className="caption" style={{ margin: '0.9rem 0 0.35rem' }}>No password? A link by email works too.</p>
        <Submit quiet formAction={sendAction}>{sent ? 'Send the link again' : 'Send me a link'}</Submit>
      </form>

      {pwState.error && <p className="alert">{pwState.error}</p>}
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
          Open the link on the phone you use on site. It expires shortly and works once.
        </p>
      )}
    </>
  );
}
