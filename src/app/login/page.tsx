import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Site Diary' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : '/';

  return (
    <main className="sheet">
      <div className="brand">
        <span className="brand__mark" aria-hidden />
        <span className="brand__name">Site Diary</span>
      </div>
      <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.5rem', fontWeight: 600 }}>Sign in</h1>
      <p style={{ color: 'var(--ink-60)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
        No password. We send a link to your work email — open it on this phone.
      </p>
      <hr className="rule" />
      <LoginForm next={next} initialError={params.error} />
    </main>
  );
}
