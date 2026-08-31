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
    <main className="app-shell app-shell--narrow">
      <section className="sheet auth-card">
        <div className="brand">
          <span className="brand__mark" aria-hidden />
          <span className="brand__name">Site Diary</span>
        </div>
        <h1 className="page-title">Sign in</h1>
        <p className="page-subtitle">
          No password. Scan the QR your site admin gives you, or send yourself a fallback
          link and open it on this phone.
        </p>
        <hr className="rule" />
        <LoginForm next={next} initialError={params.error} />
      </section>
    </main>
  );
}
