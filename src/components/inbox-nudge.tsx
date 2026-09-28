import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

/** A line on the home page when the office has sent something not yet opened (README R112). Draws nothing otherwise. */
export async function InboxNudge({ userId }: { userId: string }) {
  const supabase = await createClient();
  const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('recipient_id', userId).is('read_at', null);
  if (!count) return null;
  return (
    <Link href="/inbox" className="inbox-nudge">
      <span className="inbox-nudge__dot" aria-hidden />
      <span><strong>{count} new message{count === 1 ? '' : 's'} from the office</strong> · tap to read</span>
    </Link>
  );
}
