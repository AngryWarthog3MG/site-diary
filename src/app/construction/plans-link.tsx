'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/** A signed link to a services plans file, fetched on the phone under the viewer's own access. */
export function PlansLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('services-plans').createSignedUrl(path, 3600);
      if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [path]);
  return url ? <a href={url} target="_blank" rel="noopener">plans</a> : <span>plans</span>;
}
