/**
 * The register number a supervisor said, if they said one.
 *
 * "V7", "variation 7", "VR-007", "#7" and "7" all mean register item 7. The
 * client's own reference ("VR-014 as per the PM's email") is not the day's
 * number — but when it is only a number in disguise, it is. Anything that
 * does not read as a plain 1–999 stays unpicked and the gap asks.
 *
 * Dependency-free on purpose: the extraction side loads under plain Node.
 */
export function parseRegisterNumber(said: string | null | undefined): number | null {
  if (!said) return null;
  const m = /^\s*(?:v(?:ariation)?|vr)?[\s\-#.]*0*(\d{1,3})\s*$/i.exec(said);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 999 ? n : null;
}
