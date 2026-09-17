import type { MemberRole } from '@/types/database';

/**
 * What each role may do and see. Pure, so the menu on the phone and the page
 * guards on the server read the same table.
 *
 *   supervisor    writes and signs the record; runs prestarts and talks
 *   admin         supervisor, plus membership and project settings
 *   pm            reads everything; writes nothing
 *   leading_hand  runs prestarts and talks; reads the diary and the weekly
 *   labourer      signs in and out at the gate and reports hazards; nothing else
 */

export const ROLES: MemberRole[] = ['supervisor', 'leading_hand', 'labourer', 'pm', 'admin'];

export const ROLE_LABEL: Record<MemberRole, string> = {
  supervisor: 'Supervisor',
  leading_hand: 'Leading hand',
  labourer: 'Labourer',
  pm: 'Project manager',
  admin: 'Admin',
};

export const ROLE_HINT: Record<MemberRole, string> = {
  supervisor: 'Records and signs their own diary; runs prestarts and toolbox talks',
  leading_hand: 'Runs prestarts, plant prestarts, toolbox talks and the site sign-in; sees the daily diary, the weekly and Today',
  labourer: 'Signs in and out at the gate and reports hazards and incidents — nothing else',
  pm: 'Reads everything — diary, claims, variations, reports — and writes nothing',
  admin: 'Everything a supervisor can, plus who is on the job and its settings',
};

/** Who signs people in and out at the gate: gate duty plus labourers. Mirrors app.can_sign_in(). */
export function canSignIn(role: MemberRole): boolean {
  return canRunTalks(role) || role === 'labourer';
}

/** Who reports a hazard or incident and adds updates to one. Mirrors app.can_report(). */
export function canReport(role: MemberRole): boolean {
  return canRunTalks(role) || role === 'labourer';
}

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
  | 'today' | 'entries' | 'weekly' | 'prestart' | 'plant' | 'toolbox' | 'signin' | 'swms' | 'incidents' | 'inspections' | 'permits' | 'subcontractors' | 'procedures' | 'training' | 'safety' | 'orders' | 'chemicals' | 'obligations' | 'emergency' | 'construction' | 'quality' | 'audits' | 'asbestos' | 'health' | 'environment'
  | 'claims' | 'variations' | 'progress' | 'ask' | 'documents' | 'settings';

/** Every screen there is, in the order the Members screen lists them. */
export const SCREENS: Screen[] = ['today', 'entries', 'weekly', 'signin', 'claims', 'variations', 'progress', 'quality', 'audits', 'safety', 'obligations', 'emergency', 'incidents', 'inspections', 'permits', 'swms', 'chemicals', 'asbestos', 'environment', 'construction', 'prestart', 'toolbox', 'plant', 'orders', 'training', 'health', 'subcontractors', 'procedures', 'documents', 'ask', 'settings'];

/** A membership as the gates read it: the role, and the screens ticked for this person (null = the role's list). */
export interface Access { role: MemberRole; screens?: readonly string[] | null }

/**
 * Whether this member opens this screen on this job — the one question every
 * menu, page guard and API asks. With no ticks set, the role's table answers;
 * with ticks set, exactly those screens open. Two things no tick changes: Home
 * is always there, and a labourer never gets past their two doors — the
 * database keeps them out of the record whatever is ticked (migration
 * 20260915140000), so a tick there would only show a door that does not open.
 * An admin keeps Settings, because that is the screen the ticks are set from.
 */
export function sees(member: Access, screen: Screen): boolean {
  if (screen === 'today') return true;
  if (member.role === 'labourer' && !canSee('labourer', screen)) return false;
  if (member.role === 'admin' && screen === 'settings') return true;
  if (member.screens == null) return canSee(member.role, screen);
  return member.screens.includes(screen);
}

/** The role's own list — what the tick boxes show before anyone touches them. */
export function defaultScreens(role: MemberRole): Screen[] {
  return SCREENS.filter((s) => s !== 'today' && canSee(role, s));
}

/** The screens an admin may tick for this role: everything, but a labourer's ceiling is their two doors. */
export function grantableScreens(role: MemberRole): Screen[] {
  return SCREENS.filter((s) => s !== 'today' && (role !== 'labourer' || canSee('labourer', s)));
}

/** Which screens a role gets. Everything not listed for a role is refused, not just hidden. */
export function canSee(role: MemberRole, screen: Screen): boolean {
  // The labourer keeps one more door than their two: the chemicals register. Reg. 346(3)
  // requires it be readily accessible to the workers involved in using, handling or storing
  // the chemical, and that worker is very often the labourer holding the drum.
  // And the emergency plan: reg. 43(1)(c) is about the workers knowing it, and in an emergency
  // the labourer is the one who needs the muster point (README R63).
  if (role === 'labourer') return screen === 'today' || screen === 'signin' || screen === 'incidents' || screen === 'chemicals' || screen === 'emergency';
  if (role === 'leading_hand') {
    return screen === 'today' || screen === 'entries' || screen === 'weekly' || screen === 'prestart' || screen === 'plant' || screen === 'toolbox' || screen === 'signin' || screen === 'swms' || screen === 'incidents' || screen === 'inspections' || screen === 'permits' || screen === 'procedures' || screen === 'safety' || screen === 'orders' || screen === 'chemicals' || screen === 'obligations' || screen === 'emergency' || screen === 'construction' || screen === 'quality' || screen === 'audits' || screen === 'asbestos' || screen === 'environment';
  }
  if (screen === 'settings') return canAuthorEntries(role);
  return true;
}
