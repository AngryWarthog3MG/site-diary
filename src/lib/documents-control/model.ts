/**
 * Document control as facts: kinds, and who still has to read the current
 * version. Pure; the screen and any digest read the same answer.
 */
export const DOC_KINDS = ['policy', 'procedure', 'plan', 'form', 'other'] as const;
export type ControlledKind = (typeof DOC_KINDS)[number];
export const KIND_LABEL: Record<ControlledKind, string> = { policy: 'Policy', procedure: 'Procedure', plan: 'Plan', form: 'Form', other: 'Other' };

export function normalisePerson(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Of the crew, who has and has not acknowledged this version. */
export function coverage(crew: readonly string[], acknowledged: readonly string[]): { read: string[]; unread: string[] } {
  const done = new Set(acknowledged.map(normalisePerson));
  return {
    read: crew.filter((c) => done.has(normalisePerson(c))),
    unread: crew.filter((c) => !done.has(normalisePerson(c))),
  };
}

export function versionLabel(n: number): string {
  return `v${n}`;
}
