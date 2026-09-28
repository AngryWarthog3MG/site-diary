-- Messages from the office to a person (README R112). Mitchell: "send notifications to the individual's apps — if I
-- send a notification to AJ that he needs to take photos, I can do that at any point through a separate tab under the
-- company tab; if I send a message to a labourer it needs to be through the app as well as a notification; and store
-- these — it is a good record that they were told to do certain things."
--
-- One row per message, sent by an admin of the company to one person on one of its jobs. The row is the record:
-- what was said, by whom, when, whether their phone was told, when they opened it, and when they tapped "Got it".
-- The text and the parties never change and nothing is deleted. Reads: the sender's own, the recipient's own, and
-- any admin of the company. Writes: sending (admins, through the API so the phone is told in the same breath), the
-- recipient's read and acknowledgement (RPCs, stamped by the database), the push outcome (service role).

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations (id) on delete cascade,
  project_id       uuid references public.projects (id) on delete set null,
  sender_id        uuid not null default auth.uid() references auth.users (id),
  recipient_id     uuid not null references auth.users (id),
  body             text not null check (btrim(body) <> '' and length(body) <= 2000),
  sent_at          timestamptz not null default now(),
  push_result      text check (push_result in ('sent', 'no_device', 'failed')),
  push_devices     integer,
  pushed_at        timestamptz,
  read_at          timestamptz,
  acknowledged_at  timestamptz,
  constraint messages_not_to_self check (sender_id <> recipient_id)
);
create index messages_recipient on public.messages (recipient_id, sent_at desc);
create index messages_org on public.messages (org_id, sent_at desc);

create or replace function app.messages_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.body := btrim(new.body);
    new.sender_id := coalesce(new.sender_id, auth.uid());
    -- The recipient must be on one of the company's jobs; the job named, if any, must be the company's.
    if not exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where pm.user_id = new.recipient_id and p.org_id = new.org_id) then
      raise exception 'That person is not on any of this company''s jobs.' using errcode = 'check_violation';
    end if;
    if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
      raise exception 'That job is not this company''s.' using errcode = 'check_violation';
    end if;
    new.read_at := null; new.acknowledged_at := null; new.push_result := null; new.push_devices := null; new.pushed_at := null;
    return new;
  end if;
  -- A sent message is the record: only the stamps move, and only through their own functions.
  if new.body <> old.body or new.sender_id <> old.sender_id or new.recipient_id <> old.recipient_id
     or new.org_id <> old.org_id or new.project_id is distinct from old.project_id or new.sent_at <> old.sent_at then
    raise exception 'A sent message does not change.' using errcode = 'check_violation';
  end if;
  if current_setting('app.message_stamp', true) is distinct from 'on' then
    raise exception 'A message is marked read or acknowledged through its own function.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger messages_before_write before insert or update on public.messages
  for each row execute function app.messages_before_write();

create or replace function app.messages_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Messages are never deleted — they are the record that someone was told.' using errcode = 'check_violation';
end;
$$;
create trigger messages_no_delete before delete on public.messages for each row execute function app.messages_no_delete();

-- Opened, and understood: stamped once each, by the recipient alone.
create or replace function public.mark_message_read(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform set_config('app.message_stamp', 'on', true);
  update public.messages set read_at = coalesce(read_at, now())
   where id = p_id and recipient_id = (select auth.uid())
   returning read_at into v_at;
  if v_at is null then raise exception 'Not your message.' using errcode = 'insufficient_privilege'; end if;
  return v_at;
end;
$$;
create or replace function public.acknowledge_message(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform set_config('app.message_stamp', 'on', true);
  update public.messages set read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_id and recipient_id = (select auth.uid())
   returning acknowledged_at into v_at;
  if v_at is null then raise exception 'Not your message.' using errcode = 'insufficient_privilege'; end if;
  return v_at;
end;
$$;
-- The push outcome, from the server after it has tried the phone.
create or replace function public.record_message_push(p_id uuid, p_result text, p_devices integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if current_user <> 'service_role' and not app.is_any_office() then
    raise exception 'Only the office records a push.' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.message_stamp', 'on', true);
  update public.messages set push_result = p_result, push_devices = p_devices, pushed_at = now() where id = p_id;
end;
$$;
revoke all on function public.mark_message_read(uuid), public.acknowledge_message(uuid), public.record_message_push(uuid, text, integer) from public, anon;
grant execute on function public.mark_message_read(uuid), public.acknowledge_message(uuid) to authenticated, service_role;
grant execute on function public.record_message_push(uuid, text, integer) to authenticated, service_role;

alter table public.messages enable row level security;
create policy messages_select on public.messages for select to authenticated
  using (recipient_id = (select auth.uid()) or sender_id = (select auth.uid()) or app.is_org_admin(org_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (app.is_org_admin(org_id) and sender_id = (select auth.uid()));
create policy messages_update on public.messages for update to authenticated
  using (recipient_id = (select auth.uid()) or app.is_org_admin(org_id)) with check (true);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
