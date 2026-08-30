---
name: ship
description: Test, build, deploy Site Diary to production, and verify it live. Use for any "deploy", "ship", "push to prod" request, or after completing a feature.
---

# Ship Site Diary to production

Run these in order; stop and fix on any failure.

1. **Typecheck and unit tests**
   ```bash
   npx tsc --noEmit && node --test 'src/**/*.test.ts'
   ```
2. **PDF determinism** (only if anything under `src/lib/pdf/` changed):
   `npm run pdf:check` — the daily docket must stay byte-identical across renders.
3. **Local production build**: `npm run build` (catches Next/Turbopack issues before Vercel does).
4. **Deploy**: `npx vercel deploy --prod --yes`
   - The CLI prints error-shaped JSON even on success. Trust only `"readyState": "READY"` plus the `Aliased https://site-diary-eight.vercel.app` line. If neither appears, check `npx vercel ls` — a missing new deployment means the deploy silently failed; rerun with full output.
5. **Live smoke test** — sign in through production exactly as a phone does (never assume; the register once shipped dead):
   mint a magic link with the service role (`auth.admin.generateLink`), open
   `https://site-diary-eight.vercel.app/auth/confirm?token_hash=...&type=magiclink&next=%2F`
   in headless Playwright, and assert the changed surface renders. Use
   `mitchell.vanzyl@gmail.com` for Curtin; `danny.test@example.com` only sees Test Site,
   which is deliberately `active=false` — activate it for a drill and deactivate in a
   `finally`.
6. **Drills when relevant**: `npm run drill:offline` (offline queue survives app death),
   `npm run docket:eval` (docket OCR), `npm run extraction:eval` (extraction accuracy;
   costs real tokens — only when the prompt or schema changed).

## Standing rules
- Migrations: `npx supabase db push --linked --include-all`, then verify with
  `npx supabase db query --linked` (SQL suites must be scoped to their fixtures — the
  hosted DB has real signed data).
- NEVER print env values, even masked-by-name — mask by content. `NEXT_PUBLIC_*` vars on
  Vercel need `--no-sensitive`; secrets need `--sensitive`; both need
  `--yes --value "..." < /dev/null`.
- Signed entries are immutable and their stored PDFs are the record — never regenerate or
  delete them as part of a fix.
- Service worker changes require a `VERSION` bump in `public/sw.js` or phones keep the
  stale cache.
