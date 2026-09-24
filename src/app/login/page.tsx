import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Kooboolong IMS' };

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
          <span className="brand__name">Kooboolong IMS</span>
        </div>
        <h1 className="page-title">Sign in</h1>
        <p className="page-subtitle">
          Type your email. A link comes back — tap it and you are in. No password.
        </p>
        <hr className="rule" />
        <LoginForm next={next} initialError={params.error} />
        <p className="brand__org">Kooboolong Services Pty Ltd</p>
      </section>
      <div className="brand__wave" aria-hidden />
    </main>
  );
}
