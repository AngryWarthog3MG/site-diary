/**
 * Where a quality warning points (README R99). The review screen used to
 * name the problem and leave the supervisor to find it; now each warning
 * carries a door — the section it lives in, and for a machine with no
 * prestart, the prestart form already opened on that machine. Pure.
 */
import { plantIsPrestarted, type ReviewPayload } from './schema.ts';

export interface RegisterMachine { id: string; name: string }

/** The diary's plant items with no signed prestart today, as the supervisor named them, once each. */
export function plantNeedingPrestart(payload: Pick<ReviewPayload, 'plant'>, prestarted: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of payload.plant) {
    const name = item.item?.trim();
    if (!name || plantIsPrestarted(name, prestarted)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * The register machine a diary name means — the same containment the prestart
 * check uses, so the door opens on the machine the warning is about. The
 * longest matching register name wins ("Excavator 5t" over "Excavator").
 */
export function matchRegister(name: string, register: readonly RegisterMachine[]): RegisterMachine | null {
  const a = name.trim().toLowerCase();
  if (!a) return null;
  const hits = register.filter((m) => {
    const b = m.name.trim().toLowerCase();
    return b.length > 0 && (b.includes(a) || a.includes(b));
  });
  return hits.sort((x, y) => y.name.length - x.name.length)[0] ?? null;
}

/** The prestart form's address, opened on the machine when the register knows it. */
export function prestartHref(projectId: string, machine: RegisterMachine | null): string {
  return machine ? `/plant/new?project=${projectId}&plant=${machine.id}` : `/plant/new?project=${projectId}`;
}
