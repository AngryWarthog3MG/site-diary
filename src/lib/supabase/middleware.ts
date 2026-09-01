import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Reachable without a session. Everything else requires a signed-in user.
const PUBLIC_PATHS = ['/login', '/auth/confirm', '/auth/signout', '/verify'];

/** Routes that carry their own authentication and must not be session-gated. */
const SELF_AUTHENTICATING = ['/api/ops'];

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

  return response;
}
