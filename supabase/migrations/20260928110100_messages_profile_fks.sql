-- Messages (README R112), follow-up: the sender's and recipient's names are read from profiles, and PostgREST needs a
-- foreign key to embed by — the same pattern as entries.author_id (20260902090200). Every account has a profiles row.
alter table public.messages
  add constraint messages_sender_profile_fk foreign key (sender_id) references public.profiles (id) on delete restrict,
  add constraint messages_recipient_profile_fk foreign key (recipient_id) references public.profiles (id) on delete restrict;
