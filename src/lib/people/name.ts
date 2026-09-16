/**
 * The name that goes on the sheets. Pure, relative imports only — node-tested.
 * The database holds the same rule (profiles_full_name_is_a_name); if they
 * disagree the database wins.
 */

export const NAME_MAX = 80;

export type NameResult = { ok: true; name: string } | { ok: false; message: string };

/** Tidy what was typed into a name, or say plainly why it is not one. */
export function cleanName(raw: unknown): NameResult {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, message: 'Enter your name as it should appear on the sheets.' };
  if (name.includes('@')) return { ok: false, message: 'Enter a name, not an email address.' };
  if (name.length > NAME_MAX) return { ok: false, message: `Keep it under ${NAME_MAX} characters.` };
  return { ok: true, name };
}

/** Whether this profile still needs a name before it can be used. */
export function needsName(profile: { full_name?: string | null } | null | undefined): boolean {
  return !cleanName(profile?.full_name).ok;
}
