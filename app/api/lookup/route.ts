/**
 * The show lookup, server side.
 *
 * It lives on the server because the TMDB read token lives on the server. A
 * token shipped to the browser is a token somebody else can spend, and TMDB
 * revokes access for terms breaches rather than rate-limiting them.
 */

import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';
import { lookupShow } from '@/lib/show-lookup';
import { tmdbClient } from '@/lib/tmdb/client';

/** Availability changes under us and the catalog is a file. Never cache this. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  const answer = await lookupShow({ client: tmdbClient, catalog: getCatalog() }, query);
  return NextResponse.json(answer);
}
