-- The People page (README R148): the staff row carries who to call for the person.
alter table public.staff add column if not exists emergency_contact text;
comment on column public.staff.emergency_contact is 'Who to call for this person, as the office wrote it — name and number. README R148.';
