/**
 * Where each document of a signed entry is stored. A leaf with no imports,
 * so both the generating route and the email route agree without either
 * importing the other — a route file may export nothing but its handlers.
 */
export function dailyPdfPath(entry: { project_id: string; entry_no: string | null }): string {
  return `${entry.project_id}/${entry.entry_no}.pdf`;
}

export function clientSheetPath(entry: { project_id: string; entry_no: string | null }): string {
  return `${entry.project_id}/client/${entry.entry_no}-dayworks-variations.pdf`;
}
