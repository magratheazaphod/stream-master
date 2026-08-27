/**
 * Typeahead for the show lookup.
 *
 * Search only, and deliberately so. The lookup's request budget rests on one
 * search pair and one provider call per answer; a typeahead that also asked who
 * carried each candidate would multiply the provider calls by the length of the
 * list and by every keystroke. So this endpoint resolves names and nothing else,
 * and availability stays where it was, on the answer the person asks for.
 *
 * The token lives on the server, which is why this is a route and not a fetch
 * from the browser.
 */

import { NextResponse } from 'next/server';
import { suggestTitles, type LookupTitle } from '@/lib/show-lookup';
import { tmdbClient } from '@/lib/tmdb/client';

export const dynamic = 'force-dynamic';

export type Suggestions =
  | { status: 'ok'; suggestions: LookupTitle[] }
  /** TMDB declined. Says nothing about whether the title exists, and must not. */
  | { status: 'unknown'; reason: string };

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
  const found = await suggestTitles(tmdbClient, query);
  if (found === 'error') {
    return NextResponse.json({ status: 'unknown', reason: 'TMDB did not answer the search' });
  }
  return NextResponse.json({ status: 'ok', suggestions: found });
}
