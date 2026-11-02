'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtPerthDate, perthDate } from '@/lib/pdf/dates';
import { monthGrid, monthOf, monthStart, monthEnd } from '@/lib/deliveries/model';
import { occurrences, describeEvery, UNITS, UNIT_LABEL, STATE_LABEL, type Unit } from '@/lib/forms/schedule';
import type { ScheduleView } from '@/lib/forms/load';
import type { FormSubject } from '@/lib/forms/model';

export interface DoneOnDay { id: string; code: string; title: string; about: string | null; at: string; outcome: string | null; scheduleId: string | null }
interface TemplatePick { id: string; code: string; title: string; subject: FormSubject }
interface Props {
  orgId: string; projectId: string; userId: string; month: string; today: string;
  schedules: ScheduleView[]; done: DoneOnDay[]; templates: TemplatePick[];
  machines: Array<{ id: string; name: string }>; people: string[]; members: Array<{ id: string; name: string }>;
  canSet: boolean; canSetCompany: boolean;
}
type Chip = { key: string; date: string; tone: 'overdue' | 'today' | 'booked' | 'received' | 'order'; text: string; href: string | null; sched?: ScheduleView; done?: DoneOnDay };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLANK = { code: '', every: '1', unit: 'week' as Unit, firstDue: '', assignedTo: '', plantId: '', person: '', notes: '', company: false };

/**
 * The calendar and the schedules (README R181). A schedule is a row under the caller's RLS — set at a desk by
 * whoever runs the job, the office for a company-wide one — and retired in place; the forms it produced keep
 * pointing at it. The chips are read off the schedules and the month's completed forms; nothing is stored here.
 */
export function FormsCalendar({ projectId, orgId, month, today, schedules, done, templates, machines, people, members, canSet, canSetCompany }: Props) {
  const router = useRouter();
  const grid = monthGrid(month);
  const [day, setDay] = useState<string>(monthOf(today) === month ? today : monthStart(month));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  const live = schedules.filter((s) => s.active);
  const chips: Chip[] = [];
  for (const s of live) {
    if (!s.template) continue;
    const label = `${s.template.title}${s.about ? ` · ${s.about}` : ''}`;
    const href = `/forms/fill/new?project=${projectId}&template=${s.template.id}&schedule=${s.id}`;
    for (const d of occurrences(s, s.lastDoneOn, monthStart(month), monthEnd(month))) {
      const tone = d < today ? 'overdue' : d === today ? 'today' : 'booked';
      chips.push({ key: `s-${s.id}-${d}`, date: d, tone, text: label, href, sched: s });
    }
  }
  for (const d of done) chips.push({ key: `d-${d.id}`, date: perthDate(d.at), tone: 'received', text: `${d.title}${d.about ? ` · ${d.about}` : ''}${d.outcome === 'fail' ? ' — FAIL' : ''}`, href: `/forms/${d.id}?project=${projectId}`, done: d });
  chips.sort((a, b) => a.date.localeCompare(b.date) || (a.sched ? 0 : 1) - (b.sched ? 0 : 1));
  const byDay = new Map<string, Chip[]>();
  for (const c of chips) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);
  const selected = byDay.get(day) ?? [];
  const overdue = live.filter((s) => s.template && s.state === 'overdue');
  const pickedTemplate = templates.find((t) => t.code === form.code);

  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { const text = await fn(); setMsg({ kind: 'ok', text }); router.refresh(); }
    catch (e) {
      const m = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? 'That did not save.';
      setMsg({ kind: 'bad', text: /row-level security/i.test(m) ? (form.company ? 'Only the office sets a company-wide schedule.' : 'Your role on this job does not set schedules.') : m });
    } finally { setBusy(false); }
  }

  const add = () => run(async () => {
    if (!pickedTemplate) throw new Error('Pick the form.');
    const every = Number(form.every);
    if (!Number.isInteger(every) || every < 1 || every > 365) throw new Error('Every how many days, weeks or months — a whole number.');
    if (!form.firstDue) throw new Error('Pick the first day it falls due.');
    const row = {
      org_id: orgId, project_id: form.company ? null : projectId, template_code: pickedTemplate.code, every, unit: form.unit, first_due_on: form.firstDue,
      assigned_to: form.assignedTo || null, subject_plant_id: pickedTemplate.subject === 'plant' ? form.plantId || null : null,
      subject_person: pickedTemplate.subject === 'person' ? form.person.trim() || null : null, notes: form.notes.trim() || null,
    };
    const { error } = await createClient().from('form_schedules').insert(row);
    if (error) throw error;
    setAdding(false); setForm({ ...BLANK });
    return `${pickedTemplate.title} scheduled ${describeEvery(every, form.unit)} from ${fmtDate(form.firstDue)}.`;
  });
  const retire = (s: ScheduleView) => run(async () => {
    const { data, error } = await createClient().from('form_schedules').update({ active: false }).eq('id', s.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('That schedule could not be changed from this account.');
    return `${s.template?.title ?? s.template_code} no longer scheduled. The forms it produced stay on the file.`;
  });

  return (
    <section className="dcal">
      {msg && <p className={msg.kind === 'bad' ? 'alert' : 'notice'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}

      <div className="claims-tablewrap">
        <table className="dcal__grid" aria-label="Forms by day">
          <thead><tr>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]}>
                {week.map((date) => {
                  const list = byDay.get(date) ?? [];
                  const out = monthOf(date) !== month;
                  return (
                    <td key={date} className={`dcal__day${out ? ' dcal__day--out' : ''}${date === today ? ' dcal__day--today' : ''}${date === day ? ' dcal__day--on' : ''}`}>
                      <button type="button" className="dcal__pick" onClick={() => { setDay(date); setMsg(null); }} aria-label={`${fmtDate(date)}, ${list.length} item${list.length === 1 ? '' : 's'}`}>
                        <span className="dcal__num">{Number(date.slice(8, 10))}</span>
                        {list.slice(0, 3).map((c) => <span key={c.key} className={`dcal__chip dcal__chip--${c.tone}`}>{c.text}</span>)}
                        {list.length > 3 && <span className="dcal__more">+{list.length - 3} more</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption dcal__key"><span className="dcal__chip dcal__chip--booked">due</span> <span className="dcal__chip dcal__chip--today">due today</span> <span className="dcal__chip dcal__chip--overdue">overdue</span> <span className="dcal__chip dcal__chip--received">done</span></p>

      {overdue.length > 0 && (
        <div className="item dcal__overdue">
          <p className="label">Overdue · {overdue.length}</p>
          <ul className="plainlist">{overdue.map((s) => (
            <li key={s.id}>{s.template!.title}{s.about ? ` · ${s.about}` : ''} — was due {fmtDate(s.nextDue)}{s.assignee ? ` · ${s.assignee}` : ''} · <Link href={`/forms/fill/new?project=${projectId}&template=${s.template!.id}&schedule=${s.id}`}>Fill it now</Link></li>
          ))}</ul>
        </div>
      )}

      <div className="dcal__detail">
        <div className="review-section-head">
          <div><p className="label">{fmtDate(day)}{day === today ? ' · today' : ''}</p><h2>{selected.length === 0 ? 'Nothing on this day' : `${selected.length} on this day`}</h2></div>
        </div>
        {selected.length > 0 && (
          <ul className="plainlist">
            {selected.map((c) => (
              <li key={c.key}>
                {c.sched ? (
                  <><span className={`dcal__chip dcal__chip--${c.tone}`} style={{ display: 'inline-block' }}>{c.tone === 'overdue' ? 'overdue' : 'due'}</span> {c.text}{c.sched.assignee ? ` · ${c.sched.assignee}` : ''} · {c.href && <Link href={c.href}>Fill it</Link>}</>
                ) : (
                  <><span className="dcal__chip dcal__chip--received" style={{ display: 'inline-block' }}>done</span> {c.text} · {fmtPerthDate(c.done!.at)} · {c.href && <Link href={c.href}>Open</Link>}</>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="item">
        <div className="review-section-head">
          <div><p className="label">Schedules · {live.length}</p><h2>What falls due, and how often</h2></div>
          {canSet && !adding && <button type="button" className="button" onClick={() => { setAdding(true); setMsg(null); }}>Add a schedule</button>}
        </div>
        {adding && (
          <div className="item dcal__form">
            <div className="regs__fields">
              <label className="fieldcell regs__field regs__field--wide"><span className="label">Form</span>
                <select className="field field--sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value, plantId: '', person: '' })}>
                  <option value="">—</option>
                  {templates.map((t) => <option key={t.id} value={t.code}>{t.code} · {t.title}</option>)}
                </select></label>
              {pickedTemplate?.subject === 'plant' && (
                <label className="fieldcell regs__field"><span className="label">Machine</span>
                  <select className="field field--sm" value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                    <option value="">—</option>
                    {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></label>
              )}
              {pickedTemplate?.subject === 'person' && (
                <label className="fieldcell regs__field"><span className="label">Who it is about</span>
                  <input className="field field--sm" list="forms-cal-people" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} />
                  <datalist id="forms-cal-people">{people.map((p) => <option key={p} value={p} />)}</datalist></label>
              )}
              <label className="fieldcell regs__field"><span className="label">Every</span>
                <span style={{ display: 'flex', gap: '0.4rem' }}>
                  <input className="field field--sm" type="number" min={1} max={365} value={form.every} style={{ width: '5rem' }} onChange={(e) => setForm({ ...form, every: e.target.value })} />
                  <select className="field field--sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>{UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}{Number(form.every) === 1 ? '' : 's'}</option>)}</select>
                </span></label>
              <label className="fieldcell regs__field"><span className="label">First due</span><input className="field field--sm" type="date" value={form.firstDue} onChange={(e) => setForm({ ...form, firstDue: e.target.value })} /></label>
              <label className="fieldcell regs__field"><span className="label">Assigned to · optional</span>
                <select className="field field--sm" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                  <option value="">Whoever runs the site</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="fieldcell regs__field regs__field--wide"><span className="label">Notes · optional</span><input className="field field--sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              {canSetCompany && (
                <label className="fieldcell regs__field regs__field--wide" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={form.company} onChange={(e) => setForm({ ...form, company: e.target.checked, assignedTo: '' })} /> <span>Every job of the company, not only this one</span>
                </label>
              )}
            </div>
            <div className="regs__actions">
              <button type="button" className="button" disabled={busy} onClick={() => void add()}>{busy ? 'Saving…' : 'Schedule it'}</button>
              <button type="button" className="quotebtn" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}
        {live.length === 0 ? <p className="nil">Nothing is scheduled{canSet ? '' : ' — whoever runs the job sets one here'}.</p> : (
          <ul className="plainlist">
            {live.map((s) => (
              <li key={s.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{s.template?.title ?? `${s.template_code} (no issued revision)`}</strong>{s.about ? ` · ${s.about}` : ''}{s.project_id ? '' : ' · every job'}
                <br /><span className={`caption${s.state === 'overdue' ? ' vr-missing' : ''}`}>
                  {describeEvery(s.every, s.unit)} from {fmtDate(s.first_due_on)} · {s.nextDue ? `${STATE_LABEL[s.state]} ${fmtDate(s.nextDue)}` : 'nothing due'}
                  {s.lastDoneOn ? ` · last done ${fmtDate(s.lastDoneOn)}` : ' · not yet done'}{s.assignee ? ` · ${s.assignee}` : ''}{s.notes ? ` · ${s.notes}` : ''}
                </span>
                {canSet && (s.project_id || canSetCompany) && <> <button type="button" className="linklike" disabled={busy} onClick={() => void retire(s)}>Retire</button></>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
