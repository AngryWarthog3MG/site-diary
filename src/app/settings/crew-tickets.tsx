'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { compressPhoto } from '@/lib/photos/compress';
import { fmtDate } from '@/lib/pdf/dates';
import { TICKET_TYPES, TICKET_LABEL, normaliseName, type TicketType } from '@/lib/crew/tickets';

export interface TicketRow {
  id: string; person_name: string; ticket_type: string; ticket_no: string | null;
  issued_on: string | null; expires_on: string | null; photo_path: string | null; active: boolean;
}
export interface InductionRow { person_name: string; inducted_on: string }

/**
 * Each person on the job: the tickets the company holds for them and whether
 * they are inducted here. Tickets belong to the organisation and follow the
 * person from job to job; the induction is per job.
 */
export function CrewTickets({ orgId, projectId, people, tickets: initialTickets, inductions: initialInductions, canEdit, today }: {
  orgId: string; projectId: string; people: string[]; tickets: TicketRow[]; inductions: InductionRow[]; canEdit: boolean; today: string;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [inductions, setInductions] = useState(initialInductions);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ type: TicketType; no: string; issued: string; expires: string; photo: File | null }>({ type: 'white_card', no: '', issued: '', expires: '', photo: null });

  const inducted = new Set(inductions.map((i) => normaliseName(i.person_name)));
  const ticketsFor = (name: string) => tickets.filter((t) => t.active && normaliseName(t.person_name) === normaliseName(name));
  const state = (t: TicketRow) => (!t.expires_on ? 'ok' : t.expires_on < today ? 'expired' : t.expires_on <= addDays(today, 30) ? 'soon' : 'ok');

  async function addTicket(person: string) {
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getSession();
      const id = crypto.randomUUID();
      // The row first, so a photo never sits in storage with nothing pointing
      // at it; then the photo; then the link.
      const row = { id, org_id: orgId, person_name: person, ticket_type: form.type, ticket_no: form.no.trim() || null, issued_on: form.issued || null, expires_on: form.expires || null, photo_path: null as string | null, created_by: auth.session?.user.id };
      const { error: insErr } = await supabase.from('crew_tickets').insert(row);
      if (insErr) throw new Error(insErr.message);
      if (form.photo) {
        const photo = await compressPhoto(form.photo);
        const photo_path = `${orgId}/${id}.${photo.extension}`;
        const { error: upErr } = await supabase.storage.from('crew-tickets').upload(photo_path, photo.blob, { contentType: photo.contentType, upsert: false });
        if (upErr) throw new Error(`The ticket was saved but its photo did not upload: ${upErr.message}`);
        const { error: linkErr } = await supabase.from('crew_tickets').update({ photo_path }).eq('id', id);
        if (linkErr) throw new Error(linkErr.message);
        row.photo_path = photo_path;
      }
      setTickets([...tickets, { ...row, active: true }]);
      setForm({ type: 'white_card', no: '', issued: '', expires: '', photo: null });
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  async function retire(t: TicketRow) {
    setError(null);
    const supabase = createClient();
    const { error: upErr } = await supabase.from('crew_tickets').update({ active: false }).eq('id', t.id);
    if (upErr) { setError(upErr.message); return; }
    setTickets(tickets.map((x) => (x.id === t.id ? { ...x, active: false } : x)));
  }

  async function induct(person: string) {
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getSession();
    const { error: insErr } = await supabase.from('crew_inductions').insert({ project_id: projectId, person_name: person, inducted_by: auth.session?.user.id });
    if (insErr) { setError(insErr.message); return; }
    setInductions([...inductions, { person_name: person, inducted_on: today }]);
  }

  return (
    <div className="tickets">
      <p className="label">Tickets and inductions</p>
      <p className="caption">
        Tickets follow the person across every job; the induction is for this job. The plant prestart
        refuses an operator whose recorded tickets do not cover the machine, and the crew prestart marks a
        sign-on from someone not inducted here.
      </p>
      {people.length === 0 && <p className="caption">Add the crew above first.</p>}
      <ul className="tickets__people">
        {people.map((person) => {
          const mine = ticketsFor(person);
          const worst = mine.some((t) => state(t) === 'expired') ? 'expired' : mine.some((t) => state(t) === 'soon') ? 'soon' : mine.length ? 'ok' : 'none';
          const isOpen = open === person;
          return (
            <li key={person} className={`ticketrow ticketrow--${worst}`}>
              <button type="button" className="ticketrow__head" onClick={() => setOpen(isOpen ? null : person)}>
                <span className="machine__name">{person}</span>
                <span className="machine__meta">
                  {mine.length === 0 ? 'No tickets recorded' : `${mine.length} ticket${mine.length === 1 ? '' : 's'}${worst === 'expired' ? ' · one expired' : worst === 'soon' ? ' · one expiring soon' : ''}`}
                  {' · '}{inducted.has(normaliseName(person)) ? 'inducted' : 'not inducted here'}
                </span>
              </button>
              {isOpen && (
                <div className="ticketrow__body">
                  {mine.map((t) => (
                    <div key={t.id} className={`ticket ticket--${state(t)}`}>
                      <span>
                        <b>{TICKET_LABEL[t.ticket_type as TicketType] ?? t.ticket_type}</b>
                        {t.ticket_no ? <span className="mono"> · {t.ticket_no}</span> : null}
                        {t.expires_on ? ` · ${state(t) === 'expired' ? 'expired' : 'expires'} ${fmtDate(t.expires_on)}` : ' · no expiry'}
                      </span>
                      {canEdit && <button type="button" className="quotebtn quotebtn--remove" onClick={() => void retire(t)}>Remove</button>}
                    </div>
                  ))}
                  {!inducted.has(normaliseName(person)) && canEdit && (
                    <button type="button" className="button button--outline" onClick={() => void induct(person)}>Inducted on this job today</button>
                  )}
                  {canEdit && (
                    <div className="addticket">
                      <div className="photo-add-pair">
                        <label className="fieldcell" style={{ flex: 2 }}>
                          <span className="label">Ticket</span>
                          <select className="field field--sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TicketType })}>
                            {TICKET_TYPES.map((t) => <option key={t} value={t}>{TICKET_LABEL[t]}</option>)}
                          </select>
                        </label>
                        <label className="fieldcell" style={{ flex: 1 }}>
                          <span className="label">Number</span>
                          <input className="field field--sm" value={form.no} onChange={(e) => setForm({ ...form, no: e.target.value })} />
                        </label>
                      </div>
                      <div className="photo-add-pair">
                        <label className="fieldcell" style={{ flex: 1 }}>
                          <span className="label">Issued</span>
                          <input className="field field--sm" type="date" value={form.issued} onChange={(e) => setForm({ ...form, issued: e.target.value })} />
                        </label>
                        <label className="fieldcell" style={{ flex: 1 }}>
                          <span className="label">Expires (blank if never)</span>
                          <input className="field field--sm" type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
                        </label>
                      </div>
                      <div className="photo-add-pair">
                        <label className="button button--quiet" style={{ marginTop: 0 }}>
                          {form.photo ? 'Card photo attached' : 'Photo of the card'}
                          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setForm({ ...form, photo: e.target.files?.[0] ?? null })} />
                        </label>
                        <button type="button" className="button" style={{ marginTop: 0 }} disabled={busy} onClick={() => void addTicket(person)}>{busy ? 'Saving…' : 'Add ticket'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="alert">{error}</p>}
    </div>
  );
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
