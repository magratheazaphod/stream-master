/**
 * The show lookup, server side.
 *
 * It lives on the server because the TMDB read token lives on the server. A
 * token shipped to the browser is a token somebody else can spend, and TMDB
 * revokes access for terms breaches rather than rate-limiting them.
 *
 * Two ways in. `q` alone is the typed string, resolved by search. `tmdbId` and
 * `kind` name a title the person picked out of the suggestion list, and that
 * path skips the search so the answer is about the title they chose rather than
 * whatever the text would have resolved to on its own.
 */

import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';
import { lookupResolved, lookupShow, type LookupTitle } from '@/lib/show-lookup';
import { tmdbClient } from '@/lib/tmdb/client';

/** Availability changes under us and the catalog is a file. Never cache this. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q') ?? '';
  const deps = { client: tmdbClient, catalog: await getCatalog() };

  const tmdbId = Number(params.get('tmdbId'));
  const kind = params.get('kind');
  if (Number.isInteger(tmdbId) && tmdbId > 0 && (kind === 'series' || kind === 'film')) {
    const year = Number(params.get('year'));
    const title: LookupTitle = {
      tmdbId,
      name: params.get('name') ?? query,
      kind,
      ...(Number.isFinite(year) && year > 0 ? { year } : {}),
    };
    return NextResponse.json(await lookupResolved(deps, title, query || title.name));
  }

  return NextResponse.json(await lookupShow(deps, query));
}
