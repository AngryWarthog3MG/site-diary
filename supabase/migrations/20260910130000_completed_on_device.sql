-- Prestarts, toolbox talks and plant prestarts can now be finished with no
-- signal and sent later. completed_at stays the moment the record reached the
-- database; completed_on_device_at is the moment the person pressed Finish or
-- signed, by the phone's clock. The PDF prints both when they differ, because
-- "finished 06:48, received 09:02" is the truth and "finished 09:02" is not.
alter table public.prestarts       add column if not exists completed_on_device_at timestamptz;
alter table public.toolbox_talks   add column if not exists completed_on_device_at timestamptz;
alter table public.plant_prestarts add column if not exists completed_on_device_at timestamptz;
