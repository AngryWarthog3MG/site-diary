# Shipping Site Diary to production

Tool-neutral procedure. Run in order; stop and fix on any failure.

1. **Typecheck and unit tests**
   ```bash
   npx tsc --noEmit && node --test 'src/**/*.test.ts'
   ```
2. **SQL suites** — required if anything under `supabase/` changed:
   ```bash
   npm run db:test
   ```
   The database triggers are the hard gate on signing, immutability and RLS. `npm test`
   does not touch them and neither does `npm run test:all`. A migration that weakens a
   signing gap will pass every other check in this list.
3. **PDF determinism** — only if anything under `src/lib/pdf/` changed:
   ```bash
   npm run pdf:check
   ```
   The daily docket must stay byte-identical across renders.
4. **Local production build** — catches Next/Turbopack issues before Vercel does:
   ```bash
   npm run build
   ```
5. **Deploy**
   ```bash
   npx vercel deploy --prod --yes
   ```
   The CLI prints error-shaped JSON even on success. Trust only `"readyState": "READY"`
   plus the `Aliased https://kbsdailydiary.me` line (the alias Vercel prints; the public address is `ims-kooboolong.net`, README R119). If neither appears, check
   `npx vercel ls` — a missing new deployment means the deploy silently failed; rerun with
   full output.

   **`Error: Not authorized` on the first deploy of a session is the CLI sign-in expiring, not
   a permission problem — run the same command again.** The CLI's saved sign-in lasts eight
   hours (`expiresAt` in its `auth.json`). A deploy after it lapses renews it but fails itself;
   the rerun succeeds. Seen 24/09, 25/09 and 26/09, each time with the renewal stamped seconds
   before. Do not `vercel login` again or touch team settings for this. If a second run also
   says Not authorized, then it is real: check `npx vercel whoami` and the team membership.
6. **Live smoke test.** Sign in through production exactly as a phone does. Never assume —
   the register once shipped dead. Mint a magic link with the service role
   (`auth.admin.generateLink`), open
   `https://ims-kooboolong.net/auth/confirm?token_hash=...&type=magiclink&next=%2F`
   in headless Playwright, and assert the changed surface renders.
   Use `mitchell.vanzyl@gmail.com` for Curtin. `danny.test@example.com` only sees Test
   Site, which is deliberately `active=false` — activate it for a drill and deactivate in a
   `finally`.
7. **Drills, when relevant**
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

## What each command actually covers

| | typecheck | unit tests | SQL suites | PDF determinism |
|---|---|---|---|---|
| `npm test` | ✓ | ✓ | | |
| `npm run db:test` | | | ✓ | |
| `npm run pdf:check` | | | | ✓ |
| `npm run test:all` | ✓ | ✓ | | ✓ |

Nothing runs all four. `npm run db:test` has to be chosen deliberately.

## Moving the address (README R119)

The app never assumes its own address. Everything that writes it — sign-in links, the
welcome note, the gate QR and sign, order and incident emails — reads `siteUrl()`, which
is `NEXT_PUBLIC_SITE_URL`. A redirect from every other host is switched on by naming the
one address in `CANONICAL_HOST`. So a move is configuration plus one line of docket text:

1. Attach the new names to the project: `npx vercel domains add <name> site-diary` (apex and www).
2. At the registrar: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`. `npx vercel domains
   inspect <name>` says when Vercel is satisfied.
3. Add `https://<name>/**` (and www) to `additional_redirect_urls` in `supabase/config.toml` and push
   it (Mitchell, from his terminal, reading the diff) BEFORE the switch — a magic link to a host not on
   that list falls back to `site_url`, which is localhost, and nobody can sign in.
4. Set `NEXT_PUBLIC_SITE_URL=https://<name>` and `CANONICAL_HOST=<name>` in Vercel's production env.
5. Change the "verify this document at …" line in `src/lib/pdf/docket.tsx` and `client-sheet.tsx`
   to the new host. Dockets already stored keep the old host, which is why the old name redirects
   for good and is never released.
6. Deploy, then the live check: sign in on the new host, the old host redirects with the path kept,
   a gate QR encodes the new host, `/verify` answers on both.
7. Tell the crews (Company › Messages): sign in once on the new address, put it on the home
   screen, and turn notifications back on — a push registration belongs to the address it was
   made on.

The email sender stays `diary@kbsdailydiary.me` until the new domain is verified with Resend;
that is DNS at the registrar again, and a separate step.
