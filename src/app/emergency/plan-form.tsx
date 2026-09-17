'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { EmergencyPlan } from '@/lib/emergency/load';

interface Props {
  projectId: string;
  current: EmergencyPlan | null;
}

/**
 * Write the plan, or issue a new version of it. A new version starts from the
 * one in force, so a supervisor changes only what changed. Nothing is filled in
 * for them from another job: reg. 43(3) is exactly that the plan fits THIS site.
 */
export function PlanForm({ projectId, current }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(current == null);
  const [muster, setMuster] = useState(current?.muster_point ?? '');
  const [address, setAddress] = useState(current?.site_address ?? '');
  const [hospital, setHospital] = useState(current?.nearest_hospital ?? '');
  const [contacts, setContacts] = useState(current?.emergency_contacts ?? '');
  const [firstAiders, setFirstAiders] = useState((current?.first_aiders ?? []).join(', '));
  const [firstAidAt, setFirstAidAt] = useState(current?.first_aid_location ?? '');
  const [fireAt, setFireAt] = useState(current?.fire_equipment_location ?? '');
  const [evacuation, setEvacuation] = useState(current?.evacuation_procedure ?? '');
  const [notify, setNotify] = useState(current?.notify_procedure ?? '');
  const [spill, setSpill] = useState(current?.spill_response ?? '');
  const [hazards, setHazards] = useState(current?.site_hazards ?? '');
  const [every, setEvery] = useState(String(current?.test_every_months ?? 6));
  const [training, setTraining] = useState(current?.training_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    const months = Number(every);
    if (!muster.trim()) { setError('Say where everyone musters.'); return; }
    if (!evacuation.trim()) { setError('Say how the site is evacuated.'); return; }
    if (!Number.isInteger(months) || months < 1 || months > 24) { setError('Test the procedures every 1 to 24 months.'); return; }
    setBusy(true);
    setError(null);
    try {
      const nul = (v: string) => (v.trim() ? v.trim() : null);
      const { error: e } = await createClient().from('emergency_plans').insert({
        project_id: projectId,
        muster_point: muster.trim(),
        site_address: nul(address), nearest_hospital: nul(hospital), emergency_contacts: nul(contacts),
        first_aiders: firstAiders.split(',').map((x) => x.trim()).filter(Boolean),
        first_aid_location: nul(firstAidAt), fire_equipment_location: nul(fireAt),
        evacuation_procedure: evacuation.trim(), notify_procedure: nul(notify), spill_response: nul(spill),
        site_hazards: nul(hazards), test_every_months: months, training_note: nul(training),
        // version, issued_by and issued_at are the database's.
        version: 0,
      });
      if (e) throw new Error(e.message);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan did not save.');
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder = '', rows = 0) => (
    <label className="fieldcell">
      <span className="label">{label}</span>
      {rows > 0
        ? <textarea className="field field--sm" id={id} rows={rows} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
        : <input className="field field--sm" id={id} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />}
    </label>
  );

  if (!open) {
    return (
      <p style={{ marginTop: '1rem' }}>
        <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>Issue a new version of the plan</button>
      </p>
    );
  }

  return (
    <section className="item" style={{ marginTop: '1rem' }}>
      <p className="label">{current ? `Version ${current.version + 1} of the plan` : 'The emergency plan for this workplace'}</p>
      <p className="caption">Written for this site. Once issued it does not change — a change is a new version.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {field('ep-muster', 'Muster point', muster, setMuster, 'Site sheds car park, by the green gate')}
      {field('ep-address', 'Site address, as you would give it to 000', address, setAddress, 'Kent St entrance, Curtin University, Bentley WA 6102')}
      {field('ep-hospital', 'Nearest hospital with an emergency department', hospital, setHospital, 'Fiona Stanley Hospital, 11 Robin Warren Dr, Murdoch — 15 min')}
      {field('ep-contacts', 'Who to call', contacts, setContacts, 'Site supervisor: Matt 04…\nHead contractor site manager: …\nWorkSafe WA: 1800 678 198', 3)}
      {field('ep-firstaiders', 'First aiders on this site (comma between names)', firstAiders, setFirstAiders, 'Matthew Rodgers, Evan Burke')}
      <div className="signin__grid">
        {field('ep-firstaid', 'First aid kit kept', firstAidAt, setFirstAidAt, 'Site office, ute 2')}
        {field('ep-fire', 'Fire equipment kept', fireAt, setFireAt, 'Extinguisher in each machine and the office')}
      </div>
      {field('ep-evac', 'How the site is evacuated', evacuation, setEvacuation, 'Three long blasts on the air horn. Stop plant, make safe, walk to the muster point. Supervisor takes the sign-in list and counts heads.', 4)}
      {field('ep-notify', 'Who tells whom', notify, setNotify, 'Supervisor calls 000, then the head contractor, then the office. The office calls WorkSafe for a notifiable incident.', 3)}
      {field('ep-spill', 'Spills', spill, setSpill, 'Spill kit in the fuel trailer. Stop the source, contain with sand bags, call the supervisor.', 2)}
      {field('ep-hazards', 'Hazards on this site that shape the response', hazards, setHazards, 'Live services under the car park, open excavations, public footpath', 2)}
      <div className="signin__grid">
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Test every (months)</span>
          <input className="field field--sm" id="ep-every" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
        </label>
        {field('ep-training', 'How the crew are told', training, setTraining, 'At induction and on the prestart board')}
      </div>
      <button type="button" className="button" disabled={busy || !muster.trim() || !evacuation.trim()} onClick={() => void issue()}>
        {busy ? 'Issuing…' : current ? `Issue version ${current.version + 1}` : 'Issue the plan'}
      </button>
      {current && <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>}
    </section>
  );
}
