/**
 * Development scripts spend real money, and must never spend the money the
 * live site runs on.
 *
 * On 7 September 2026 the extraction eval was run four times in an evening
 * against the production key. It drained the balance twice and took writing-up,
 * Ask and both Spec tabs down on site until the account was topped up. The
 * recordings were safe throughout — nothing was lost but the app's ability to
 * write them up, and the supervisor's trust in it.
 *
 * So an eval reads ANTHROPIC_DEV_API_KEY and nothing else. Put a spend cap on
 * that key in the Console. If it is missing the script stops rather than
 * quietly falling back to production, because a silent fallback is exactly the
 * failure this exists to prevent.
 */
export function useDevKey(what: string): void {
  const dev = process.env.ANTHROPIC_DEV_API_KEY;
  if (!dev) {
    console.error(
      `\n${what} spends real credit, so it will not run on the production key.\n\n` +
        'Set ANTHROPIC_DEV_API_KEY in .env.local to a separate key with a spend cap:\n' +
        '  1. console.anthropic.com → Settings → API keys → Create key ("site-diary-dev")\n' +
        '  2. Limits → set a monthly cap on that key (US$20 is plenty)\n' +
        '  3. Add ANTHROPIC_DEV_API_KEY=sk-ant-... to .env.local (never to Vercel)\n\n' +
        'The production key stays where it is and is not used here.\n',
    );
    process.exit(1);
  }
  if (dev === process.env.ANTHROPIC_API_KEY) {
    console.error(
      '\nANTHROPIC_DEV_API_KEY is the same key as ANTHROPIC_API_KEY.\n' +
        'That is the production key, so a runaway script would take the site down again.\n' +
        'Create a separate key with its own spend cap.\n',
    );
    process.exit(1);
  }
  // Everything downstream constructs `new Anthropic()`, which reads this.
  process.env.ANTHROPIC_API_KEY = dev;
}
