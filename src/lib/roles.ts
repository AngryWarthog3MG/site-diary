import type { MemberRole } from '@/types/database';

/**
 * What each role may do and see. Pure, so the menu on the phone and the page
 * guards on the server read the same table.
 *
 *   supervisor    writes and signs the record; runs prestarts and talks
 *   admin         supervisor, plus membership and project settings
 *   pm            reads everything; writes nothing
 *   leading_hand  runs prestarts and talks; reads the diary and the weekly
 */

export const ROLES: MemberRole[] = ['supervisor', 'leading_hand', 'pm', 'admin'];

export const ROLE_LABEL: Record<MemberRole, string> = {
  supervisor: 'Supervisor',
  leading_hand: 'Leading hand',
  pm: 'Project manager',
  admin: 'Admin',
};

export const ROLE_HINT: Record<MemberRole, string> = {
  supervisor: 'Records and signs their own diary; runs prestarts and toolbox talks',
  leading_hand: 'Runs prestarts and toolbox talks; sees past days, the weekly and Today',
  pm: 'Reads everything — diary, claims, variations, reports — and writes nothing',
  admin: 'Everything a supervisor can, plus who is on the job and its settings',
};

/** Supervisors and admins write the record. */
export function canAuthorEntries(role: MemberRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

/** Who can run a prestart or a toolbox talk. Mirrors app.can_run_talks(). */
export function canRunTalks(role: MemberRole): boolean {
  return role === 'supervisor' || role === 'admin' || role === 'leading_hand';
}

/**
 * Who changes the registers beside the record — variation status and details,
 * docket numbers recorded after signing, job documents. Mirrors
 * app.can_manage_registers(). The leading hand reads them.
 */
export function canManageRegisters(role: MemberRole): boolean {
  return role === 'supervisor' || role === 'admin' || role === 'pm';
}

/** Who takes the payroll, client and monthly exports out of the building. */
export function canExportReports(role: MemberRole): boolean {
  return role === 'supervisor' || role === 'admin' || role === 'pm';
}

export type Screen =
  | 'today' | 'entries' | 'weekly' | 'prestart' | 'toolbox'
  | 'claims' | 'variations' | 'progress' | 'ask' | 'documents' | 'settings';

/** Which screens a role gets. Everything not listed for a role is refused, not just hidden. */
export function canSee(role: MemberRole, screen: Screen): boolean {
  if (role === 'leading_hand') {
    return screen === 'today' || screen === 'entries' || screen === 'weekly' || screen === 'prestart' || screen === 'toolbox';
  }
  if (screen === 'settings') return canAuthorEntries(role);
  return true;
}
