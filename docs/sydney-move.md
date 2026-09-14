# Moving the record to Sydney

The app runs in Sydney (Vercel `syd1`). The database and every stored file do not: the
linked Supabase project `site-diary-prod` (`upnkkqqwstwtmfqmmbjh`) is in `ap-northeast-1`,
Tokyo. This runbook moves the record to a Sydney project so that everything the diary
stores is held in Australia. Supabase has no in-place region change; the move is a new
project, a copy, a verification, and a cutover.

Owner's decision, 2026-09-14. Nothing below runs until the window is agreed.

## What is being moved (measured 2026-09-14)

| Thing | Size / count |
|---|---|
| Database | 25 MB, 43 public tables, 91 triggers, 72 applied migrations |
| Diary | 30 entries, 28 signed, 2 organisations, 2 projects |
| Auth | 6 users (magic-link sign-in; no passwords to carry) |
| `entry-photos` | 100 files, 84 MB |
| `exports` (signed PDFs, weeklies, nightly `_backups/`) | 61 files, 105 MB |
| `project-documents` | 19 files, 38 MB |
| `entry-audio` | 4 files, 5.7 MB |
| `crew-tickets` | empty |
| Extensions | pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault |
| Push | `push_subscriptions` rows; VAPID keys live in Vercel and do not change |

What points at the project: three Vercel variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), the same three in
`.env.local`, the `supabase link` in this checkout, and the project ref written in
`AGENTS.md`. Resend, Deepgram, Anthropic, the VAPID keys and the Vercel crons do not
reference the project and do not change.

## Before the night (daytime, no downtime, ~2 hours)

1. **Check the dashboard for a built-in region migration first.** If Supabase now offers
   one for this plan, use it and skip to *Verify*.
2. **Create the Sydney project** in the same organisation: name `site-diary-prod-syd`,
   region `ap-southeast-2`, Postgres 17, the same plan and compute size as Tokyo. Record
   the new ref, URL, anon key, service-role key and the database password in the password
   manager. Never paste them into chat.
3. **Auth settings, side by side with the old dashboard:** Site URL
   `https://kbsdailydiary.me`; redirect URLs (`https://kbsdailydiary.me/**`,
   `https://www.kbsdailydiary.me/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`);
   custom SMTP through Resend (`smtp.resend.com`, port 465, user `resend`, the sender
   address, sender name "Site Diary"); magic-link template subject and body; OTP length 6,
   expiry 3600 s, rate limit 60 emails/hour, JWT expiry 43200 s, refresh-token rotation on,
   anonymous sign-ins off. Do **not** `supabase config push` — `config.toml` carries the
   localhost site URL.
4. **Rehearse the copy into the Sydney project** (it is empty, so this is safe to repeat):

   ```bash
   # Tokyo → files, using the direct connection strings (not the pooler)
   npx supabase db dump --db-url "$OLD_DB_URL" -f /tmp/mv/roles.sql --role-only
   npx supabase db dump --db-url "$OLD_DB_URL" -f /tmp/mv/schema.sql
   npx supabase db dump --db-url "$OLD_DB_URL" -f /tmp/mv/data.sql --use-copy --data-only
   ```

   ```bash
   # files → Sydney, one transaction, triggers off while the rows land
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file /tmp/mv/roles.sql --file /tmp/mv/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file /tmp/mv/data.sql --dbname "$NEW_DB_URL"
   ```

   Triggers must be off for the load: the immutability trigger would otherwise refuse
   rows that arrive already signed, and the serial trigger would re-issue serials. The
   data dump carries `auth.users`, `auth.identities` and `storage.objects` metadata, so
   people keep their ids (every `author_id` and `signed_by` depends on that).
5. **Copy the files** with a script that lists each bucket in Tokyo, downloads every
   object and uploads it to the same path in Sydney, then re-lists both sides and compares
   count and SHA-256 per file. ~230 MB; a few minutes. The script writes a manifest
   (`path, bytes, sha256, ok`) so the check is a file, not a memory.
6. **Migration history:** `npx supabase migration list --db-url "$NEW_DB_URL"` must show
   all 72 applied. If the dump did not carry `supabase_migrations`, repair with
   `supabase migration repair --status applied` for each, so future `db push` works.
7. **Verify on the rehearsal** (see *Verify*). Then wipe the Sydney data
   (`supabase db reset --db-url "$NEW_DB_URL"` is not available on hosted; drop and
   re-create the public/auth/storage data with the same load, or simply repeat the load on
   the night — the load is idempotent only into an empty project, so reset by re-creating
   the project if a rehearsal must be redone).

## The night (freeze window, ~45 minutes, after knock-off Perth time)

Tell Matty the day before: sign the day by 7 pm, do not open the app between 7:30 and
8:30 pm, and expect to sign in again afterwards.

1. **Freeze.** Confirm no open autosaves: no entry updated in the last 10 minutes,
   outbox empty on the phones you can see. From here nobody writes.
2. **Final copy.** Repeat steps 4–6 above against the *empty* Sydney project (delete and
   re-create it after the rehearsal so the night's load lands on nothing).
3. **Verify** (below). Do not go on until every line passes.
4. **Cut over.**
   - Vercel: set the three variables for Production to the Sydney values.
   - `public/sw.js`: bump `VERSION` so every phone drops the cached shell that carries the
     Tokyo URL.
   - Deploy with `npx vercel deploy --prod --yes`; confirm Ready and aliased.
   - This checkout: `npx supabase link --project-ref <new ref>`, update `.env.local`,
     update the ref in `AGENTS.md` and memory. Commit.
5. **Pause the Tokyo project** immediately after the smoke test passes. Paused, not
   deleted: a stale phone that still holds the Tokyo URL then fails loudly and reloads,
   rather than writing a day into a database nobody reads.
6. **Smoke test as yourself** (magic link): Today, Past days, open a draft and see its
   rows, a signed day's stored PDF opens (the stored file, not a re-render), the weekly
   generates, prestarts, plant, Ask, one photo upload on the sandbox T001. Then run
   `/api/ops/check?resume=1&backup=1&errors=1&orphans=1&tickets=1` and read the email.
7. **Tell Matty** to sign in again.

## Verify — the same list on the rehearsal and on the night

- Row counts equal for every public table (one query on each side, diffed).
- `select count(*) filter (where app.verify_entry_hash(id)), count(*) from public.entries
  where status = 'signed'` → 28 / 28 (or whatever Tokyo says the same minute).
- `auth.users` = 6, same ids as Tokyo.
- Every bucket: same object count, every SHA-256 in the manifest `ok`. The signed PDFs
  in `exports` are the record; a single mismatch stops the move.
- `supabase migration list` shows 72 applied.
- Every SQL suite passes against Sydney
  (`npx supabase db query --db-url "$NEW_DB_URL" -f supabase/tests/NN.sql`, silence is
  a pass).

## Rollback

Until the Tokyo project is paused, rollback is the three Vercel variables back to Tokyo
and a redeploy — ten minutes. Anything written to Sydney in between is lost, which is why
the window is short and the smoke test comes before anyone else is let back in. After the
pause, rollback is un-pausing Tokyo plus the same variable change.

## After

- Keep Tokyo paused for 14 days, then delete it.
- The nightly backup snapshot and the weekly cron carry on unchanged; check the first
  email from each.
- Transcription and extraction still process offshore for the seconds they run. If a
  contract needs those onshore too, that is a separate piece of work (Claude through
  Amazon's Sydney region; an onshore transcription provider).

## Cost

One extra Pro project for the overlap fortnight, pro-rated. Nothing else changes.
