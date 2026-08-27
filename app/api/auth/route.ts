/**
 * Sign in and sign out.
 *
 * The one route middleware lets through unauthenticated, so it does its own
 * configuration check rather than inheriting one.
 */

import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  configErrorMessage,
  configProblems,
} from '@/lib/auth/config';
import { verifyPassword } from '@/lib/auth/password';
import { signInLimiter } from '@/lib/auth/rate-limit';
import { signSession } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who is knocking, as well as a proxy can tell.
 *
 * Vercel sets `x-forwarded-for` itself and a client cannot override it there.
 * Behind no proxy at all the header is absent and every attempt shares one
 * bucket, which is stricter than intended and never looser.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: Request) {
  const problems = configProblems();
  if (problems.length > 0) {
    return NextResponse.json({ error: configErrorMessage(problems) }, { status: 503 });
  }

  const key = clientKey(request);
  const verdict = signInLimiter.attempt(key);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } },
    );
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const ok = password !== '' && (await verifyPassword(password, process.env.FAMILY_PASSWORD_HASH!));
  if (!ok) {
    // One message for an empty field, a wrong password and a rotated hash. The
    // form has nothing useful to distinguish and an attacker has nothing to learn.
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  }

  signInLimiter.reset(key);
  const token = await signSession(process.env.SESSION_SECRET!, SESSION_MAX_AGE_SECONDS);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Vercel serves HTTPS everywhere. Locally over plain HTTP a secure cookie
    // would never come back, so the flag follows the environment.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

/** Sign out. Clears the cookie and says nothing else. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
