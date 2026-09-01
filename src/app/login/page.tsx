import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · KBS Daily Diary' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : '/';

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet auth-card">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand__frog" src="/brand/frog.png" alt="" width={34} height={38} />
          <span className="brand__name">KBS Daily Diary</span>
        </div>
        <h1 className="page-title">Sign in</h1>
        <p className="page-subtitle">
          No password. Scan the QR your site admin gives you, or send yourself a fallback
          link and open it on this phone.
        </p>
        <hr className="rule" />
        <LoginForm next={next} initialError={params.error} />
        <p className="brand__org">Kooboolong Services Pty Ltd</p>
      </section>
      <div className="brand__wave" aria-hidden />
    </main>
  );
}
