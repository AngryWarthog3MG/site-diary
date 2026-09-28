# Backups

What copies of the record exist, where they are, how to set the off-site one up,
and how to bring it back. README R113 has the reasoning.

## The three copies

| Copy | What it holds | Where | Who makes it |
|---|---|---|---|
| Supabase daily backup | the database only — never Storage files | Supabase, same region | Supabase, on the Pro plan and above; kept 7 days. The Free plan has none |
| The app's nightly snapshot | 21 diary tables as JSON | `exports/_backups/` in the same project; 14 kept | `/api/ops/check?backup=1`, 04:00 AWST |
| **The off-site copy** | every file in every bucket, plus a full database dump | an S3-compatible bucket the company holds, outside Supabase | `.github/workflows/backup.yml`, 05:30 AWST |

Only the third survives losing the Supabase project, and only the third has the
photographs, the audio and the signed PDFs in it. Supabase says so itself:
restoring a database backup "does not restore objects you deleted after that
backup". The nightly job never deletes anything in the copy — it is append-only,
so nothing the app does by mistake can reach it.

## Setting the off-site copy up (once, about twenty minutes)

**1. A bucket.** Cloudflare R2 is the plain choice: no charge to get data out,
about US$0.015 per GB-month held, ten GB free. Backblaze B2 is the same shape and
a similar price. In R2: create a bucket named `kooboolong-ims-backup` (any name;
it goes in a secret), location hint Asia-Pacific. Then *Manage R2 API tokens* →
create a token with **Object Read & Write** limited to that bucket. It shows an
Access Key ID, a Secret Access Key and the account's S3 endpoint
(`https://<account id>.r2.cloudflarestorage.com`). Copy all three before closing
the page; the secret is shown once.

**2. The database connection string.** Supabase dashboard → *Connect* (top of
the project) → **Session pooler**. GitHub's runners have no IPv6 and the direct
host is IPv6-only, so it must be the pooler string. It looks like
`postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`.
The password is the database password from project settings, not the service
key. If it has ever been pasted anywhere it should not have been, reset it there
first.

**3. GitHub secrets.** Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | the session pooler string from step 2 |
| `SUPABASE_URL` | the project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | the service role key from API settings |
| `BACKUP_S3_ENDPOINT` | the S3 endpoint from step 1 |
| `BACKUP_S3_BUCKET` | the bucket name from step 1 |
| `BACKUP_S3_ACCESS_KEY_ID` | from step 1 |
| `BACKUP_S3_SECRET_ACCESS_KEY` | from step 1 |
| `BACKUP_S3_REGION` | `auto` for R2 (or leave unset); B2's region name otherwise |

**4. The first run.** Actions → *Off-site backup* → Run workflow. The first run
copies everything (a gigabyte or so today; it takes a while). Every run after
that copies only what is new or changed. The last line of the log is the
night's summary, for example:

```
2026-09-29: 421 objects, 861.3 MB across 14 buckets · copied 421 (861.3 MB) · dumps 3 · no failures
```

A missing secret, a file that would not copy, or a dump that failed makes the
run red, and GitHub emails the repository's owner. Nothing about a failure is
silent.

## What lands in the bucket

```
storage/<bucket>/<path>       every Storage object, path kept whole, never overwritten with less
db/<date>/roles.sql.gz        the roles, schema and data dumps of that night
db/<date>/schema.sql.gz
db/<date>/data.sql.gz
manifests/<date>.json         what was found, what moved, what failed, per bucket
```

Dates are Perth's. The dumps accumulate at roughly the database's size each
night (35 MB uncompressed today; a few MB gzipped). If that ever matters, set a
lifecycle rule in R2 on the `db/` prefix — ninety days is plenty, the files
themselves under `storage/` are the ones that must stay — and never on
`storage/`.

## Running it by hand

From a checkout with `.env.local` (which already has the Supabase side) and the
four `BACKUP_S3_*` values in the environment:

```bash
node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backup-offsite.mjs --dry-run
```

lists every bucket and says what would move. Without `--dry-run` it copies.
`--buckets entry-audio,swms-docs` limits it. The database dump needs the
Supabase CLI and Docker, which is why the workflow does that part.

## Bringing it back

Supabase's own guide (Platform → Backups → *Restore to a new project*) is what
the dump is shaped for. In short, against a NEW project's session pooler string:

```bash
gunzip roles.sql.gz schema.sql.gz data.sql.gz
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "<new project's session pooler string>"
```

Roles, then schema, then data, in that order. Custom roles need their passwords
set again on the new project. Then the files: create the buckets (the names are
the second path segment under `storage/`) and copy each prefix back with any
S3 client — `aws s3 sync s3://<backup>/storage/entry-photos/ ...` and so on —
or, if only a handful of files are wanted, download them from the R2 dashboard.
The app's own Storage policies and the `entries` rows reference the same paths,
so a file put back at its old path is found again.

## The quarterly restore test

A backup nobody has restored is a hope. What's due carries a company-wide
preset, *Restore test — the off-site backup brought back and checked*, every
three months (ISO/IEC 27001 A.8.13). The test:

1. Pick last night's `manifests/<date>.json`; note the object and byte counts.
2. Restore the three dumps into a scratch Supabase project (or `supabase start`
   locally) with the commands above; check `select count(*) from entries` and
   a couple of the record tables against the live project's counts that morning.
3. Download five files at random from `storage/` — a photograph, an audio file,
   a signed docket, a SWMS, a document — and open each.
4. Tick the obligation done with what was checked in the note. Delete the
   scratch project.

If any step fails, that is an incident against the system, not a chore missed:
raise it on `/incidents` so the fix is on the record.
