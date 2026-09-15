import { canAuthorEntries, canSee, type Screen } from './roles';
import type { MemberRole } from '@/types/database';

/**
 * The one list of the app's sections. The home page draws it as tiles, the
 * phone's Menu drawer draws it as a list, the desktop rail draws it as links.
 * Three drawings, one list — a section added here appears in all three, and a
 * label changed here changes everywhere at once.
 *
 * `screen` is what `canSee` judges; `when` covers the two doors that are not
 * a screen of their own: the crew pages (anyone who can write the diary) and
 * All jobs (anyone on more than one).
 */
export interface NavItem {
  href: string;
  name: string;
  /** The rail's shorter label, when the full name would wrap. */
  short?: string;
  what: string;
  screen?: Screen;
  when?: 'canRecord' | 'multiJob';
}

export interface NavGroup { label: string; items: NavItem[] }

export const HOME_ITEM: NavItem = { href: '/', name: 'Home', what: 'Today’s diary — record it, or type it in', screen: 'today' };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'The record',
    items: [
      { href: '/entries', name: 'Daily Diary', what: 'Every day’s diary — signed days and their PDFs', screen: 'entries' },
      { href: '/reports/weekly', name: 'Weekly report', what: 'The week, rolled up', screen: 'weekly' },
      { href: '/claims', name: 'Claims', what: 'Delays, variations, dayworks', screen: 'claims' },
      { href: '/variations', name: 'Variation register', what: 'V-001 to V-050 — each one from raised to paid', screen: 'variations' },
      { href: '/progress', name: 'Progress', what: 'How far along each area is', screen: 'progress' },
      { href: '/safety', name: 'Safety', what: 'Open actions, expiring tickets, injuries and rates — read from the record', screen: 'safety' },
    ],
  },
  {
    label: 'On site',
    items: [
      { href: '/signin', name: 'Site sign-in', what: 'Who is on site now — in and out at the gate', screen: 'signin' },
      { href: '/prestart', name: 'Prestarts', what: 'Morning briefing and sign-on', screen: 'prestart' },
      { href: '/swms', name: 'SWMS & JSA', what: 'Method statements and who has signed on', screen: 'swms' },
      { href: '/incidents', name: 'Hazards & incidents', what: 'Report it in a minute; actions until it is closed', screen: 'incidents' },
      { href: '/inspections', name: 'Inspections', what: 'Site walks, environmental and quality checks', screen: 'inspections' },
      { href: '/permits', name: 'Permits to work', what: 'Hot work, excavation, confined space, heights, electrical', screen: 'permits' },
      { href: '/procedures', name: 'Policies & procedures', what: 'The company documents, versioned; who has read the current one', screen: 'procedures' },
      { href: '/plant', name: 'Plant', what: 'Machine prestarts, defects and the register', screen: 'plant' },
      { href: '/toolbox', name: 'Toolbox talks', what: 'Weekly talk and sign-on', screen: 'toolbox' },
      { href: '/ask', name: 'Ask a question', short: 'Ask', what: 'From your diary and the job documents', screen: 'ask' },
      { href: '/documents', name: 'Job documents', what: 'Spec, scope, contract, drawings', screen: 'documents' },
      { href: '/portfolio', name: 'All jobs', what: 'Every active site at once', when: 'multiJob' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/subcontractors', name: 'Subcontractors', what: 'Insurances, SWMS and licences, chased before they lapse', screen: 'subcontractors' },
      { href: '/training', name: 'Training matrix', what: 'Who holds what, what each role needs, what is expiring', screen: 'training' },
      { href: '/settings', name: 'Settings', what: 'Hours, emails, crew and plant lists', screen: 'settings' },
      { href: '/settings/members', name: 'Who is on this job', what: 'Crew and PM access', when: 'canRecord' },
      { href: '/settings/vocabulary', name: 'Words and names', what: 'Names and site terms', when: 'canRecord' },
    ],
  },
];

/**
 * The sections every role has. Drawn while the role is still unknown (the
 * drawer and rail learn it a moment after they open), so nobody sees a door
 * that closes on them; the pages refuse anything a role should not reach anyway.
 */
export const EVERY_ROLE: Screen[] = ['today', 'entries', 'weekly', 'prestart', 'plant', 'toolbox', 'signin', 'swms', 'incidents', 'inspections', 'permits', 'procedures', 'safety'];

export interface NavViewer { role: MemberRole | null; canRecord: boolean; multiJob: boolean }

/** Whether this viewer gets this door. A null role means "not known yet". */
export function showNav(item: NavItem, viewer: NavViewer): boolean {
  if (item.when === 'canRecord') return viewer.canRecord;
  if (item.when === 'multiJob') return viewer.multiJob;
  if (!item.screen) return true;
  return viewer.role ? canSee(viewer.role, item.screen) : EVERY_ROLE.includes(item.screen);
}

/** The viewer a role implies, for a server page that already knows it. */
export function viewerFor(role: MemberRole, activeJobs: number): NavViewer {
  return { role, canRecord: canAuthorEntries(role), multiJob: activeJobs > 1 };
}
