import { canAuthorEntries, sees, type Access, type Screen } from './roles';
import type { MemberRole } from '@/types/database';

/**
 * The one list of the app's sections. The home page draws it as the heading
 * bar with a panel under each heading, the phone's Menu drawer draws it as a
 * list, the desktop rail draws it as links.
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
    label: 'Diary',
    items: [
      { href: '/entries', name: 'Daily Diary', what: 'Every day’s diary — signed days and their PDFs', screen: 'entries' },
      { href: '/signin', name: 'Site sign-in', what: 'Who is on site now — in and out at the gate', screen: 'signin' },
      { href: '/reports/weekly', name: 'Weekly report', what: 'The week, rolled up', screen: 'weekly' },
    ],
  },
  {
    label: 'Claims',
    items: [
      { href: '/claims', name: 'Claims', what: 'Delays, variations, dayworks', screen: 'claims' },
      { href: '/variations', name: 'Variation tracker', what: 'Each one walked from raised to paid — where it is, what it waits on', screen: 'variations' },
      { href: '/progress', name: 'Progress', what: 'How far along each area is', screen: 'progress' },
    ],
  },
  {
    label: 'Quality',
    items: [
      { href: '/quality', name: 'Quality', what: 'Inspection and test plans, lots and hold points, non-conformances', screen: 'quality' },
      { href: '/audits', name: 'Audits and reviews', short: 'Audits', what: 'Internal audits, management reviews, and their actions until closed', screen: 'audits' },
      { href: '/quality/equipment', name: 'Calibration register', short: 'Calibration', what: 'Measuring equipment and when each is due', screen: 'quality' },
    ],
  },
  {
    label: 'Safety',
    items: [
      { href: '/safety', name: 'Safety dashboard', short: 'Safety', what: 'Open actions, expiring tickets, injuries and rates — read from the record', screen: 'safety' },
      { href: '/emergency', name: 'Emergency plan', short: 'Emergency', what: 'Muster point, nearest hospital, who to call — and the drills that test it', screen: 'emergency' },
      { href: '/due', name: "What's due", what: 'Audits, reviews, drills, safety data sheets and tickets, in the order they need doing', screen: 'obligations' },
      { href: '/incidents', name: 'Hazards & incidents', what: 'Report it in a minute; actions until it is closed', screen: 'incidents' },
      { href: '/inspections', name: 'Inspections', what: 'Site walks, environmental and quality checks', screen: 'inspections' },
      { href: '/permits', name: 'Permits to work', what: 'Hot work, excavation, confined space, heights, electrical', screen: 'permits' },
      { href: '/swms', name: 'SWMS & JSA', what: 'Method statements and who has signed on', screen: 'swms' },
      { href: '/asbestos', name: 'Asbestos', what: 'The site register, its management plan, the crew briefed, and any removal', screen: 'asbestos' },
      { href: '/chemicals', name: 'Chemicals & SDS', short: 'Chemicals', what: 'What is on site, and a current safety data sheet for each', screen: 'chemicals' },
    ],
  },
  {
    label: 'Site',
    items: [
      { href: '/prestart', name: 'Prestarts', what: 'Morning briefing and sign-on', screen: 'prestart' },
      { href: '/toolbox', name: 'Toolbox talks', what: 'Weekly talk and sign-on', screen: 'toolbox' },
      { href: '/construction', name: 'Construction records', short: 'Construction', what: 'WHS management plan, services and trenches for each dig, white cards', screen: 'construction' },
      { href: '/plant', name: 'Plant', what: 'Machine prestarts, defects and the register', screen: 'plant' },
      { href: '/orders', name: 'Orders & plant issues', short: 'Orders', what: 'Diesel, consumables, anything to order — and a light out on a machine', screen: 'orders' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/training', name: 'Training matrix', what: 'Who holds what, what each role needs, what is expiring', screen: 'training' },
      { href: '/subcontractors', name: 'Subcontractors', what: 'Insurances, SWMS and licences, chased before they lapse', screen: 'subcontractors' },
      { href: '/settings/members', name: 'Who is on this job', what: 'Crew and PM access', when: 'canRecord' },
    ],
  },
  {
    label: 'Library',
    items: [
      { href: '/procedures', name: 'Policies & procedures', what: 'The company documents, versioned; who has read the current one', screen: 'procedures' },
      { href: '/documents', name: 'Job documents', what: 'Spec, scope, contract, drawings', screen: 'documents' },
      { href: '/ask', name: 'Ask a question', short: 'Ask', what: 'From your diary and the job documents', screen: 'ask' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/settings', name: 'Settings', what: 'Hours, emails, crew and plant lists', screen: 'settings' },
      { href: '/settings/vocabulary', name: 'Words and names', what: 'Names and site terms', when: 'canRecord' },
      { href: '/portfolio', name: 'All jobs', what: 'Every active site at once', when: 'multiJob' },
    ],
  },
];

/**
 * The sections every role has. Drawn while the role is still unknown (the
 * drawer and rail learn it a moment after they open), so nobody sees a door
 * that closes on them; the pages refuse anything a role should not reach anyway.
 */
export const EVERY_ROLE: Screen[] = ['today', 'entries', 'weekly', 'prestart', 'plant', 'toolbox', 'signin', 'swms', 'incidents', 'inspections', 'permits', 'procedures', 'safety', 'orders', 'chemicals', 'obligations', 'emergency', 'construction', 'quality', 'audits', 'asbestos'];

export interface NavViewer { role: MemberRole | null; screens?: readonly string[] | null; canRecord: boolean; multiJob: boolean }

/** The groups this viewer gets, each holding only the doors they get; empty groups dropped. */
export function navFor(viewer: NavViewer): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((it) => showNav(it, viewer)) })).filter((g) => g.items.length > 0);
}

/** Whether this viewer gets this door. A null role means "not known yet". */
export function showNav(item: NavItem, viewer: NavViewer): boolean {
  const member: Access | null = viewer.role ? { role: viewer.role, screens: viewer.screens ?? null } : null;
  // The crew pages live under Settings: an authoring role gets them, unless Settings is unticked for this person.
  if (item.when === 'canRecord') return viewer.canRecord && (member ? sees(member, 'settings') : true);
  // All jobs is the owner's screen: several jobs, and a role that reads the record on them.
  if (item.when === 'multiJob') return viewer.multiJob && (member ? sees(member, 'weekly') : false);
  if (!item.screen) return true;
  return member ? sees(member, item.screen) : EVERY_ROLE.includes(item.screen);
}

/** The viewer a membership implies, for a server page that already knows it. */
export function viewerFor(member: Access, activeJobs: number): NavViewer {
  return { role: member.role, screens: member.screens ?? null, canRecord: canAuthorEntries(member.role), multiJob: activeJobs > 1 };
}
