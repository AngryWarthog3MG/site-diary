'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { localDate } from '@/lib/capture/queue';
import { BrandMark } from '@/components/brand-mark';

/** Topic, what was covered, who presented — then hand the phone around. */
export function NewTalkForm({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [summary, setSummary] = useState('');
  const [presenter, setPresenter] = useState('');
  const [date, setDate] = useState(localDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('toolbox_talks')
        .insert({
          project_id: projectId,
          talk_date: date,
          topic: topic.trim(),
          summary: summary.trim(),
          presenter_name: presenter.trim(),
          conducted_by: auth.user?.id,
        })
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);
      router.push(`/toolbox/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The talk was not created.');
      setBusy(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {projectName}
      </p>
      <h1 className="page-title">New toolbox talk</h1>
      <hr className="rule" />
      <label className="fieldcell">
        <span className="label">Date</span>
        <input className="field field--sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">Topic</span>
        <input className="field" value={topic} placeholder="Working around live services"
          onChange={(e) => setTopic(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">What was covered</span>
        <textarea className="field" rows={6} value={summary}
          placeholder="Key points, site-specific hazards discussed, questions raised…"
          onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">Presented by</span>
        <input className="field field--sm" value={presenter} placeholder="Matty"
          onChange={(e) => setPresenter(e.target.value)} />
      </label>
      {error && <p className="alert">{error}</p>}
      <button className="button" type="button" disabled={busy || !topic.trim() || !summary.trim() || !presenter.trim()} onClick={create}>
        {busy ? 'Creating…' : 'Start the talk'}
      </button>
      <Link className="button button--quiet" href="/toolbox">Back to talks</Link>
    </main>
  );
}
