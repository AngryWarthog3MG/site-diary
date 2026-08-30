# Shipping Site Diary to production

Tool-neutral procedure. Run in order; stop and fix on any failure.

1. **Typecheck and unit tests**
   ```bash
   npx tsc --noEmit && node --test 'src/**/*.test.ts'
   ```
2. **PDF determinism** — only if anything under `src/lib/pdf/` changed:
   ```bash
   npm run pdf:check
   ```
   The daily docket must stay byte-identical across renders.
3. **Local production build** — catches Next/Turbopack issues before Vercel does:
   ```bash
   npm run build
   ```
4. **Deploy**
   ```bash
   npx vercel deploy --prod --yes
   ```
   The CLI prints error-shaped JSON even on success. Trust only `"readyState": "READY"`
   plus the `Aliased https://site-diary-eight.vercel.app` line. If neither appears, check
   `npx vercel ls` — a missing new deployment means the deploy silently failed; rerun with
   full output.
5. **Live smoke test.** Sign in through production exactly as a phone does. Never assume —
   the register once shipped dead. Mint a magic link with the service role
   (`auth.admin.generateLink`), open
   `https://site-diary-eight.vercel.app/auth/confirm?token_hash=...&type=magiclink&next=%2F`
   in headless Playwright, and assert the changed surface renders.
   Use `mitchell.vanzyl@gmail.com` for Curtin. `danny.test@example.com` only sees Test
   Site, which is deliberately `active=false` — activate it for a drill and deactivate in a
   `finally`.
6. **Drills, when relevant**
   ```bash
   npm run drill:offline     # offline queue survives app death
   npm run docket:eval       # docket OCR
   npm run extraction:eval   # extraction accuracy — costs real tokens
   ```
   Run `extraction:eval` only when the prompt or schema changed.

## Standing rules

- **Migrations**: `npx supabase db push --linked --include-all`, then verify with
  `npx supabase db query --linked`. SQL suites must be scoped to their own fixtures — the
  hosted database holds real signed entries.
- **Never print environment values**, even masked by name. Mask by content.
  `NEXT_PUBLIC_*` vars on Vercel need `--no-sensitive`; secrets need `--sensitive`; both
  need `--yes --value "..." < /dev/null`.
- **Signed entries are immutable and their stored PDFs are the record.** Never regenerate
  or delete one as part of a fix.
- **Service worker changes require a `VERSION` bump** in `public/sw.js`, or phones keep the
  stale cache.
