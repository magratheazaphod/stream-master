/**
 * The gate. Every request in this app passes through here first.
 *
 * Three rules, in order, and the order is the point:
 *
 * 1. A missing or malformed environment refuses everything. Not the pages, not
 *    the API, not a static-looking route. The failure mode of an auth gate must
 *    be closed, and the way you guarantee that is to check the configuration
 *    before you check anything else.
 * 2. An unauthenticated API request gets 401 JSON. A redirect to HTML would
 *    have `fetch` parse a sign-in page as a subscription list.
 * 3. Everything else without a valid session goes to /signin, carrying where it
 *    was headed so the family lands where they meant to.
 *
 * The runtime is deliberately left unset. Vercel runs middleware on Node now,
 * but Next 15.5.22 does not build a Node middleware: setting
 * `runtime: 'nodejs'` here compiles without a word and emits an EMPTY
 * middleware-manifest, which ships the app with no gate at all. Verified by
 * building it both ways and reading `.next/server/middleware-manifest.json`.
 * `middleware.test.ts` fails if anybody sets it again. Nothing in this file
 * needs Node anyway - it verifies a signed cookie with Web Crypto, which is
 * identical on both runtimes, and the scrypt work lives in
 * `app/api/auth/route.ts` where it belongs.
 *
 * The password is never checked here. Middleware sees only the cookie, so an
 * unauthenticated flood never costs a scrypt derivation.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, configErrorMessage, configProblems } from '@/lib/auth/config';
import { verifySession } from '@/lib/auth/session';

/** Routes reachable without a session. Kept short and enumerated by hand. */
const PUBLIC_PATHS = new Set(['/signin', '/api/auth']);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function isApi(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Rule 1. Configuration first, and it applies to the public paths too: an
  // unconfigured app must not even show a form that cannot possibly work.
  const problems = configProblems();
  if (problems.length > 0) {
    const message = configErrorMessage(problems);
    if (isApi(pathname)) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return new NextResponse(message, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(process.env.SESSION_SECRET!, token);
  if (session) return NextResponse.next();

  // Rule 2. Machines get a status code, not a login page.
  if (isApi(pathname)) {
    return NextResponse.json({ error: 'Sign in to use this app.' }, { status: 401 });
  }

  // Rule 3. People get the form, and get sent back where they were going.
  const signin = new URL('/signin', request.url);
  const from = `${pathname}${search}`;
  if (from !== '/') signin.searchParams.set('from', from);
  const response = NextResponse.redirect(signin);
  // An expired or tampered cookie is not worth carrying around.
  if (token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. The negative
   * lookahead is the documented Next idiom; listing routes positively is how a
   * new page ships unprotected six months from now.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
