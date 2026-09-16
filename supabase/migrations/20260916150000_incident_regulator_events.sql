-- ============================================================================
-- Notifiable incidents: the regulator trail.
--
-- WHS Act 2020 (WA) s. 38 requires notice to the regulator "immediately after
-- becoming aware" of a notifiable incident; s. 38(4)(b) lets the regulator,
-- where notice was by telephone, require written notice within 48 hours of that
-- requirement being made; s. 38(7) requires the record kept "for at least 5
-- years from the day that notice of the incident is given to the regulator";
-- s. 39 requires the site left undisturbed until an inspector arrives or
-- directs otherwise.
--
-- Until now the report carried one boolean, `notifiable`. Compliance turns on
-- times, not on a flag: when the business became aware, when it told WorkSafe,
-- when written notice was required and when it was given, and who held the
-- duty to preserve the site. The research (README R59) found exactly that.
--
-- These are EVENTS, not columns, and for a reason. The report is frozen on its
-- first account (20260914150000), and a regulator trail unfolds over days — the
-- written notice is required after the call, the site is released after the
-- inspector comes. Rather than punch holes in a frozen row, each step is a
-- dated, attributed row of its own, never rewritten or deleted, in the same way
-- incident_updates are. The state is read off the events.
--
-- Two findings from verification shape it:
--   - the preservation duty in s. 39 falls on the person with management or
--     control of the workplace, often the principal contractor rather than the
--     subcontractor reporting, so the event names the duty-holder instead of
--     assuming it;
--   - no duty to store a regulator reference number was found (refuted 0-3), so
--     there is a place to write one down and nothing requires it.
-- ============================================================================

create table public.incident_regulator_events (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.incidents (id) on delete restrict,
  kind          text not null check (kind in (
                  'became_aware',            -- the business became aware it was notifiable
                  'notified',                -- WorkSafe WA told
                  'written_notice_required', -- the regulator required written notice (s. 38(4)(b))
                  'written_notice_given',    -- written notice given
                  'site_preserved',          -- the site left undisturbed (s. 39), naming who holds the duty
                  'site_released'            -- an inspector attended or directed the site be released
                )),
  happened_at   timestamptz not null,
  method        text check (method is null or method in ('phone', 'online', 'in_person', 'email')),
  -- Who: the person who called, the WorkSafe officer, the duty-holder, the inspector.
  person_name   text,
  detail        text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now()
);
create index incident_regulator_events_idx on public.incident_regulator_events (incident_id, happened_at);

create or replace function app.regulator_event_project(p_incident uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select project_id from public.incidents where id = p_incident $$;
grant execute on function app.regulator_event_project(uuid) to authenticated;

create or replace function app.incident_regulator_events_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  -- A few minutes of clock drift between a phone and the server is allowed; a time
  -- further ahead than that is a typing error, not an event.
  if new.happened_at > now() + interval '10 minutes' then
    raise exception 'That time is in the future.' using errcode = 'check_violation';
  end if;
  if new.kind = 'site_preserved' and length(btrim(coalesce(new.person_name, ''))) = 0 then
    raise exception 'Name who has management or control of the workplace — the duty to preserve the site is theirs.'
      using errcode = 'check_violation';
  end if;
  if new.kind = 'notified' and new.method is null then
    raise exception 'Say how WorkSafe was told — phone, online, in person or email.' using errcode = 'check_violation';
  end if;
  new.person_name := nullif(btrim(coalesce(new.person_name, '')), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  return new;
end; $$;
create trigger a_incident_regulator_events_before_insert before insert on public.incident_regulator_events
  for each row execute function app.incident_regulator_events_before_insert();
create trigger a_incident_regulator_events_no_update before update on public.incident_regulator_events
  for each row execute function app.frozen_row();
create trigger a_incident_regulator_events_no_delete before delete on public.incident_regulator_events
  for each row execute function app.frozen_row();

alter table public.incident_regulator_events enable row level security;

-- Dealing with the regulator is the business's act, not the reporter's: managers write it.
-- Everyone who reads the record reads it; a labourer, who reports hazards but does not read
-- the record, does not.
create policy incident_regulator_events_select on public.incident_regulator_events
  for select to authenticated using (
    app.is_project_member(app.regulator_event_project(incident_id))
    and app.reads_record(app.regulator_event_project(incident_id)));
create policy incident_regulator_events_insert on public.incident_regulator_events
  for insert to authenticated with check (app.can_manage_incidents(app.regulator_event_project(incident_id)));

grant select, insert on public.incident_regulator_events to authenticated;
grant all on public.incident_regulator_events to service_role;
