import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandMark } from '@/components/brand-mark';
import { needsName } from '@/lib/people/name';
import { NameForm } from './name-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your name · KBS Daily Diary' };

/**
 * The name that goes on the sheets. Anyone signed in without one is sent here
 * by requireUser before any other screen, so no prestart, sign-on or signed
 * diary prints an email address where a person's name belongs. The same page
 * changes it later. It deliberately does not call requireUser — that would
 * send a nameless account round in a loop.
 */
export default async function NamePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const first = needsName(profile as { full_name: string | null } | null);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> KBS Daily Diary</p>
      <h1 className="page-title">{first ? 'What is your name?' : 'Your name'}</h1>
      <p className="page-subtitle">
        {first
          ? 'This is the name printed on the sheets you fill in and sign: prestarts, sign-ons, reports and the diary. You only need to do this once.'
          : 'This is the name printed on the sheets you fill in and sign. Your email address stays how you sign in and is not printed.'}
      </p>
      <NameForm userId={user.id} email={user.email ?? null} current={(profile?.full_name as string | null) ?? ''} first={first} />
    </main>
  );
}
