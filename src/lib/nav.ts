// `.ts` on purpose: `src/lib/jobs.ts` is node-tested and loads this file directly.
import { canAuthorEntries, sees, type Access, type Screen } from './roles.ts';
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
 *
 * Two parts, Site and Company (README R87, R111). A group's `scope` says which:
 * 'site' is this job's own record; 'company' is the office's — the same on
 * every job — with headings of its own, so nobody edits the company's list
 * believing it is this job's. A section that is honestly both (Plant: the
 * machines here, and the fleet behind them) stays with the job and labels its
 * company half on the page.
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

/** Two parts (README R111): the job you are standing on, and the company that runs every job. */
export type NavScope = 'site' | 'company';
export interface NavGroup { label: string; items: NavItem[]; scope: NavScope }

/** The two parts' names: the site's headings are captioned as this job's; the company's carry its name. */
export const SITE_LABEL = 'Site';
export const COMPANY_LABEL = 'Company';

export const HOME_ITEM: NavItem = { href: '/', name: 'Home', what: 'Today’s diary — record it, or type it in', screen: 'today' };

export const NAV_GROUPS: NavGroup[] = [
  // ---- Site: this job's own record ------------------------------------------------------------
  {
    label: 'Diary', scope: 'site',
    items: [
      { href: '/entries', name: 'Daily Diary', what: 'Every day’s diary — signed days and their PDFs', screen: 'entries' },
      { href: '/signin', name: 'Site sign-in', what: 'Who is on site now — in and out at the gate', screen: 'signin' },
      { href: '/prestart', name: 'Prestarts', what: 'Morning briefing and sign-on', screen: 'prestart' },
      { href: '/reports/weekly', name: 'Weekly report', what: 'The week, rolled up', screen: 'weekly' },
    ],
  },
  {
    label: 'Works', scope: 'site',
    items: [
      { href: '/programme', name: 'Programme', what: 'The construction programme as issued, and the two-week look-aheads', screen: 'programme' },
      { href: '/toolbox', name: 'Toolbox talks', what: 'Weekly talk and sign-on', screen: 'toolbox' },
      { href: '/construction', name: 'Construction records', short: 'Construction', what: 'WHS management plan, services and trenches for each dig, white cards', screen: 'construction' },
      { href: '/plant', name: 'Plant', what: 'Machine prestarts, defects and the register', screen: 'plant' },
      { href: '/orders', name: 'Orders & plant issues', short: 'Orders', what: 'Diesel, consumables, anything to order — and a light out on a machine', screen: 'orders' },
    ],
  },
  {
    label: 'Claims', scope: 'site',
    items: [
      { href: '/claims', name: 'Claims', what: 'Delays, variations, dayworks', screen: 'claims' },
      { href: '/dayworks', name: 'Dayworks schedule', short: 'Dayworks', what: 'Works completed under daywork and the total hours, by period — printable', screen: 'claims' },
      { href: '/variations', name: 'Variation tracker', what: 'Each one walked from raised to paid — where it is, what it waits on', screen: 'variations' },
      { href: '/notices', name: 'Notices', what: 'Instructions and events from the diary, and the notices we send about them', screen: 'notices' },
      { href: '/progress', name: 'Progress', what: 'How far along each area is', screen: 'progress' },
    ],
  },
  {
    label: 'Quality', scope: 'site',
    items: [
      { href: '/quality', name: 'Quality', what: 'Inspection and test plans, lots and hold points, non-conformances', screen: 'quality' },
      { href: '/audits', name: 'Audits and reviews', short: 'Audits', what: 'Internal audits, management reviews, and their actions until closed', screen: 'audits' },
    ],
  },
  {
    label: 'Safety', scope: 'site',
    items: [
      { href: '/safety', name: 'Safety dashboard', short: 'Safety', what: 'Open actions, expiring tickets, injuries and rates — read from the record', screen: 'safety' },
      { href: '/emergency', name: 'Emergency plan', short: 'Emergency', what: 'Muster point, nearest hospital, who to call — and the drills that test it', screen: 'emergency' },
      { href: '/due', name: "What's due", what: 'Audits, reviews, drills, safety data sheets and tickets, in the order they need doing', screen: 'obligations' },
      { href: '/incidents', name: 'Hazards & incidents', what: 'Report it in a minute; actions until it is closed', screen: 'incidents' },
      { href: '/inspections', name: 'Inspections', what: 'Site walks, environmental and quality checks', screen: 'inspections' },
      { href: '/permits', name: 'Permits to work', what: 'Hot work, excavation, confined space, heights, electrical', screen: 'permits' },
      { href: '/swms', name: 'SWMS & JSA', what: 'Method statements — written here or filed as documents — and who has signed on', screen: 'swms' },
      { href: '/swms/sign', name: 'Sign on to a SWMS', short: 'Sign on', what: 'Read the method statement for your work and sign on from your own phone', screen: 'swms_sign' },
      { href: '/asbestos', name: 'Asbestos', what: 'The site register, its management plan, the crew briefed, and any removal', screen: 'asbestos' },
      { href: '/environment', name: 'Environment', what: 'Aspects and impacts, legal register, compliance checks, monitoring, after-rain checks', screen: 'environment' },
      { href: '/chemicals', name: 'Chemicals & SDS', short: 'Chemicals', what: 'What is on site, and a current safety data sheet for each', screen: 'chemicals' },
    ],
  },
  {
    label: 'People', scope: 'site',
    items: [
      { href: '/training', name: 'Training matrix', what: 'Who holds what, what each role needs, what is expiring — this job, or the whole company', screen: 'training' },
      { href: '/settings/members', name: 'Who is on this job', what: 'Crew, roles, access and inductions', when: 'canRecord' },
    ],
  },
  {
    label: 'Library', scope: 'site',
    items: [
      { href: '/procedures', name: 'Policies & procedures', what: 'The company documents, versioned; read the current one and sign that you have', screen: 'procedures' },
      { href: '/documents', name: 'Job documents', what: 'Spec, scope, contract, drawings', screen: 'documents' },
      { href: '/ask', name: 'Ask a question', short: 'Ask', what: 'From your diary and the job documents', screen: 'ask' },
    ],
  },
  {
    label: 'Setup', scope: 'site',
    items: [
      { href: '/mobilisation', name: 'Mobilisation', what: 'What this job needs before and as it starts — stamped from the company’s templates', screen: 'start_gate' },
      { href: '/settings', name: 'Settings', what: 'Hours, emails, crew and plant lists', screen: 'settings' },
      { href: '/name', name: 'Your name', what: 'How your name prints on the sheets' },
      { href: '/settings/vocabulary', name: 'Words and names', what: 'Names and site terms', when: 'canRecord' },
    ],
  },
  // ---- Company: the office's record, the same on every job ------------------------------------
  {
    label: 'Reports', scope: 'company',
    items: [
      { href: '/reports/company', name: 'Weekly report — all jobs', short: 'All jobs weekly', what: 'Every job’s week side by side, the company’s totals, everyone’s hours for pay', screen: 'company_weekly' },
      { href: '/portfolio', name: 'All jobs', what: 'Every active site at once', when: 'multiJob' },
    ],
  },
  {
    label: 'Staff', scope: 'company',
    items: [
      { href: '/timesheets', name: 'Timesheets', what: 'Everyone’s hours for the week, across every job, on one sheet', screen: 'timesheets' },
      { href: '/health', name: 'Health monitoring', short: 'Health', what: 'Confidential — blood lead, asbestos and Schedule 14 monitoring, for named record keepers only', screen: 'health' },
      { href: '/subcontractors', name: 'Subcontractors', what: 'Insurances, SWMS and licences, chased before they lapse', screen: 'subcontractors' },
    ],
  },
  {
    label: 'Money', scope: 'company',
    items: [
      { href: '/rates', name: 'Rates', what: 'What we charge for labour, plant and materials — the company’s, and a job’s own where its contract differs', screen: 'rates' },
    ],
  },
  {
    label: 'Standards', scope: 'company',
    items: [
      { href: '/templates', name: 'Templates', what: 'What every job starts with — mobilisation items, hold points, submittals, consumables, risks, folders — by module', screen: 'templates' },
      { href: '/quality/equipment', name: 'Calibration register', short: 'Calibration', what: 'The company’s measuring equipment and when each is due', screen: 'quality' },
    ],
  },
];

/**
 * The sections every role has. Drawn while the role is still unknown (the
 * drawer and rail learn it a moment after they open), so nobody sees a door
 * that closes on them; the pages refuse anything a role should not reach anyway.
 */
export const EVERY_ROLE: Screen[] = ['today', 'entries', 'weekly', 'prestart', 'plant', 'toolbox', 'signin', 'swms', 'swms_sign', 'incidents', 'inspections', 'permits', 'procedures', 'safety', 'orders', 'chemicals', 'obligations', 'emergency', 'construction', 'quality', 'audits', 'asbestos', 'environment'];

export interface NavViewer { role: MemberRole | null; screens?: readonly string[] | null; finance?: boolean | null; canRecord: boolean; multiJob: boolean }

/**
 * The groups this viewer gets, each holding only the doors they get; empty
 * groups dropped. The site's headings first, then the company's — the same
 * split in the drawer, the rail and the home page's bar, because they all
 * draw this. `partsFor` splits the result the way a two-tab drawing wants it.
 */
export function navFor(viewer: NavViewer): NavGroup[] {
  return NAV_GROUPS
    // The Company part is the admin's alone (README R111); the site's doors follow the role table as ever.
    .filter((g) => g.scope !== 'company' || viewer.role === 'admin')
    .map((g) => ({ ...g, items: g.items.filter((it) => showNav(it, viewer)) }))
    .filter((g) => g.items.length > 0);
}

export function partsFor(groups: NavGroup[]): { site: NavGroup[]; company: NavGroup[] } {
  return { site: groups.filter((g) => g.scope === 'site'), company: groups.filter((g) => g.scope === 'company') };
}

/** Whether this viewer gets this door. A null role means "not known yet". */
export function showNav(item: NavItem, viewer: NavViewer): boolean {
  const member: Access | null = viewer.role ? { role: viewer.role, screens: viewer.screens ?? null, finance: viewer.finance ?? null } : null;
  // The crew pages live under Settings: an authoring role gets them, unless Settings is unticked for this person.
  if (item.when === 'canRecord') return viewer.canRecord && (member ? sees(member, 'settings') : true);
  // All jobs is the owner's screen: several jobs, and a role that reads the record on them.
  if (item.when === 'multiJob') return viewer.multiJob && viewer.role === 'admin';
  if (!item.screen) return true;
  return member ? sees(member, item.screen) : EVERY_ROLE.includes(item.screen);
}

/** The viewer a membership implies, for a server page that already knows it. */
export function viewerFor(member: Access, activeJobs: number): NavViewer {
  return { role: member.role, screens: member.screens ?? null, finance: member.finance ?? null, canRecord: canAuthorEntries(member.role), multiJob: activeJobs > 1 };
}
