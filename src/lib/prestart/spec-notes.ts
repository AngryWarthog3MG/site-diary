/**
 * What a prestart keeps from the specification: one note per task the
 * supervisor chose to brief, with the requirement in the document's words
 * and where it came from. Plain data, read on the server and the phone.
 */
export interface SpecNote {
  task: string;
  area: string | null;
  requirements: string;
  citations: Array<{ document: string; revision: string | null; page: number | null }>;
}

export function readSpecNotes(value: unknown): SpecNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is SpecNote => !!v && typeof v === 'object' && typeof (v as SpecNote).task === 'string' && typeof (v as SpecNote).requirements === 'string')
    .map((v) => ({ task: v.task, area: v.area ?? null, requirements: v.requirements, citations: Array.isArray(v.citations) ? v.citations : [] }));
}
