import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { canSee, type Screen } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

// Reachable without a session. Everything else requires a signed-in user.
const PUBLIC_PATHS = ['/login', '/auth/confirm', '/auth/signout', '/verify', '/gate', '/api/gate'];

/** Routes that carry their own authentication and must not be session-gated. */
const SELF_AUTHENTICATING = ['/api/ops'];

/**
 * Which screen each path belongs to, for the role gate below. Longest prefix
 * wins, so `/signin/gate` (gate administration — supervisors and admins, the
 * same people who hold Settings) is judged before `/signin` (every crew role).
 * Paths not listed are open to every signed-in member: Home, auth, the public
 * gate, and the APIs those screens call.
 */
const SCREEN_OF_PATH: Array<[prefix: string, screen: Screen]> = [
  ['/signin/gate', 'settings'], ['/api/gate/sign', 'settings'],
  ['/entries', 'entries'], ['/record', 'entries'], ['/api/entries', 'entries'], ['/api/deepgram', 'entries'],
  ['/portfolio', 'weekly'],
  ['/reports', 'weekly'], ['/api/reports', 'weekly'],
  ['/prestart', 'prestart'], ['/api/prestart', 'prestart'],
  ['/toolbox', 'toolbox'], ['/api/toolbox', 'toolbox'],
  ['/plant', 'plant'], ['/api/plant', 'plant'],
  ['/swms', 'swms'], ['/api/swms', 'swms'],
  ['/incidents', 'incidents'], ['/api/incidents', 'incidents'],
  ['/inspections', 'inspections'], ['/api/inspections', 'inspections'],
  ['/permits', 'permits'], ['/api/permits', 'permits'],
  ['/orders', 'orders'],
  ['/signin', 'signin'], ['/api/signin', 'signin'],
  ['/procedures', 'procedures'],
  ['/subcontractors', 'subcontractors'],
  ['/training', 'training'], ['/api/training', 'training'],
  ['/safety', 'safety'], ['/api/safety', 'safety'],
  ['/claims', 'claims'], ['/variations', 'variations'], ['/progress', 'progress'],
  ['/ask', 'ask'], ['/api/ask', 'ask'],
  ['/documents', 'documents'], ['/api/documents', 'documents'],
  ['/settings', 'settings'],
];

function screenOf(pathname: string): Screen | null {
  let best: [string, Screen] | null = null;
  for (const entry of SCREEN_OF_PATH) {
    const [prefix] = entry;
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

function isPublic(pathname: string) {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    SELF_AUTHENTICATING.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

/**
 * Refreshes the auth cookie on every request and gates the app behind a
 * session. Cookie handling follows the @supabase/ssr contract exactly: the
 * response object must be rebuilt when cookies are set, and returned as-is.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession(): getUser() revalidates the token with
  // the auth server. Do not put any logic between createServerClient and here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    // An API caller gets an answer it can act on. Redirecting a fetch() to an
    // HTML login page hands the offline queue a 200 full of markup, which it
    // has every reason to read as success — and the recording it is holding is
    // the one thing that must not be discarded on a misread.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'unauthenticated', message: 'Sign in again.' } },
        { status: 401 },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  /**
   * The role gate, in one place. `canSee` is the table every menu and page
   * guard reads; here it stands in front of every path that belongs to a
   * screen, so a role that cannot see a screen cannot reach its pages or the
   * APIs behind them by typing the address — including the detail pages and
   * PDF routes that never had a guard of their own because, until the
   * labourer, every role could see every screen. Judged for the job in hand
   * when the address names one (`?project=`) and the account is on it; across
   * every membership otherwise — a person allowed on any of their jobs passes,
   * and the page's own guard decides for the job it resolves.
   */
  if (user) {
    const screen = screenOf(pathname);
    if (screen) {
      const { data } = await supabase.from('project_members').select('project_id, role').eq('user_id', user.id);
      const memberships = (data ?? []) as Array<{ project_id: string; role: MemberRole }>;
      const named = request.nextUrl.searchParams.get('project');
      const onNamed = named ? memberships.find((m) => m.project_id === named) : undefined;
      const roles = onNamed ? [onNamed.role] : memberships.map((m) => m.role);
      if (roles.length > 0 && !roles.some((r) => canSee(r, screen))) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: { code: 'forbidden', message: 'Your role on this job does not include that.' } },
            { status: 403 },
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = '';
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}
