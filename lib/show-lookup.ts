/**
 * "Do we have this show, and if not what is the cheapest way to get it."
 *
 * One search, one provider call. No season fan-out, because the request budget
 * that makes TMDB viable as sole source depends on never enumerating seasons on
 * a user's keystroke. `docs/tmdb-coverage.md` has the arithmetic.
 *
 * The consequence of that budget is the caveat this module forces every TV
 * answer to carry. Series-level provider data is a union across seasons: TMDB
 * reports Netflix for NCIS at the series level while Netflix holds 2 of its 23
 * seasons. Roughly one series in five carries a real mid-series split. Until the
 * season adapter lands, a series answer here can strand somebody mid-season, and
 * the screen has to say so rather than let the reader assume otherwise.
 */

import type { TmdbClient, TmdbResult } from './tmdb/client';
import type { TmdbCountryWatchProviders, TmdbWatchProviderOffer } from './tmdb/types';
import type { Catalog } from './domain';
import { activeSubscriptions } from './domain';
import type { Household, Service, TitleKind } from './types';

/** What TMDB resolved the typed text to. */
export interface LookupTitle {
  tmdbId: number;
  name: string;
  /** Absent when TMDB has no air or release date, which happens on new titles. */
  year?: number;
  kind: TitleKind;
}

/** A service the family already pays for that carries the title. */
export interface HeldBy {
  service: Service;
  households: Household[];
}

/**
 * A way to get the title, priced. `monthlyCost` is what the family would pay on
 * top of what it already pays, which is not always the sticker price: a service
 * somebody paused is a path back at the rate that household already had.
 */
export interface Path {
  service: Service;
  monthlyCost: number;
  /** Why the price is what it is, in the words the screen shows. */
  because: string;
  /** The paused subscription this path would resume, where one exists. */
  resumes?: string;
}

/**
 * The answer. Five states, and `unknown` is one of them: an empty or 404 answer
 * from TMDB tells us about TMDB, never about the title. Collapsing it into
 * `unavailable` would have the app deny a show exists on the strength of a gap.
 */
export type Lookup =
  | { status: 'no-match'; query: string }
  | { status: 'unknown'; title?: LookupTitle; query: string; reason: string }
  | { status: 'unavailable'; title: LookupTitle; justwatchLink?: string }
  | {
      status: 'have-it';
      title: LookupTitle;
      heldBy: HeldBy[];
      /** Carrying services nobody in the family pays for. Context, not advice. */
      alsoOn: string[];
      justwatchLink?: string;
    }
  | {
      status: 'need-it';
      title: LookupTitle;
      /** Cheapest first. Empty when nothing carrying it is a service we price. */
      paths: Path[];
      /** Carrying providers with no price on the family's record. */
      unpriced: string[];
      /** Rent or buy exists but TMDB publishes no price, so none is shown. */
      rentOrBuyOn: string[];
      justwatchLink?: string;
    };

/* -- Matching TMDB's provider names to the family's services ---------------- */

/**
 * TMDB names a provider six ways. `Netflix` and `Netflix Standard with Ads` are
 * one subscription decision, as are `Paramount Plus Premium` and its channel
 * resellers. Unmerged, one show contributes six rows describing one fact, so the
 * name is reduced to the thing somebody actually buys before it is matched.
 */
/**
 * TMDB's word for a service is not always the family's, and TMDB's drifts. It
 * renamed Apple TV+ to `Apple TV`, which collides with nothing here only because
 * the transactional storefront is `Apple TV Store`, and it still ships HBO's
 * pre-rename name years after the service became Max. Aliases are recorded rather
 * than pattern-matched: a rule loose enough to catch these is loose enough to
 * match the wrong service, and a wrong match here is a wrong price.
 */
const ALIASES: Record<string, string> = {
  hbomax: 'max',
  appletv: 'appletv+',
  amazonprimevideo: 'primevideo',
  primevideo: 'primevideo',
};

/**
 * Live-TV bundles. They carried half the raw provider splits in the coverage
 * spike and they are not a subscription-streaming decision in any sense this
 * product cares about, so naming them as a way to get a show is noise dressed as
 * an answer.
 */
const LIVE_TV_BUNDLES = new Set(['youtubetv', 'fubotv', 'sling', 'directv', 'philo', 'hulu+livetv']);

/** True for a bundle the family would never buy to watch one title. */
export function isLiveTvBundle(name: string): boolean {
  return LIVE_TV_BUNDLES.has(normalizeProviderName(name));
}

export function normalizeProviderName(name: string): string {
  const reduced = name
    .toLowerCase()
    .replace(/\bplus\b/g, '+')
    .replace(/\bwith ads\b|\bstandard\b|\bpremium\b|\bessential\b|\bbasic\b/g, '')
    .replace(/\bapple tv (channel|\+ channel)\b/g, 'apple tv+')
    .replace(/\bamazon channel\b|\bthrough .*$/g, '')
    .replace(/^amazon\s+/, '')
    .replace(/[^a-z0-9+]/g, '');
  return ALIASES[reduced] ?? reduced;
}

/** The family's service for a TMDB provider name, where the family holds one. */
export function matchService(services: Service[], providerName: string): Service | undefined {
  const wanted = normalizeProviderName(providerName);
  if (wanted === '') return undefined;
  return services.find((s) => normalizeProviderName(s.name) === wanted);
}

/* -- Pricing ---------------------------------------------------------------- */

/**
 * What getting this service would cost the family, given what it already pays.
 *
 * "Already have it" is settled family-wide before this runs, so no path here is
 * on a service anybody is currently billed for. What is left is the case that
 * still saves money: a row somebody paused. Resuming costs the same as
 * subscribing and loses nothing, so it leads, and it points at a button on this
 * same screen rather than at a signup form.
 */
function pathFor(c: Catalog, service: Service): Path {
  const paused = c.subscriptions.find((s) => s.serviceId === service.id && s.status === 'paused');
  if (paused) {
    const household = c.households.find((h) => h.id === paused.householdId);
    return {
      service,
      monthlyCost: paused.monthlyCost,
      because: `Paused in ${household?.name ?? 'one household'}. Resume it rather than buying a second copy`,
      resumes: paused.id,
    };
  }

  return {
    service,
    monthlyCost: service.monthlyPrice,
    because:
      service.sharingPolicy === 'household-only'
        ? 'Nobody pays for it, and this one is enforced per household'
        : 'Nobody in the family pays for it yet',
  };
}

/* -- The lookup ------------------------------------------------------------- */

/** Both search endpoints, so a typed title resolves whether it is a show or a film. */
async function resolveTitle(
  client: TmdbClient,
  query: string,
): Promise<LookupTitle | undefined | 'error'> {
  const [tv, movie] = await Promise.all([client.searchTv(query), client.searchMovie(query)]);
  if (tv.kind === 'error' && movie.kind === 'error') return 'error';

  const candidates: (LookupTitle & { popularity: number })[] = [];
  if (tv.kind === 'ok') {
    for (const r of tv.data.results.slice(0, 5)) {
      candidates.push({
        tmdbId: r.id,
        name: r.name,
        year: yearOf(r.first_air_date),
        kind: 'series',
        popularity: r.popularity,
      });
    }
  }
  if (movie.kind === 'ok') {
    for (const r of movie.data.results.slice(0, 5)) {
      candidates.push({
        tmdbId: r.id,
        name: r.title,
        year: yearOf(r.release_date),
        kind: 'film',
        popularity: r.popularity,
      });
    }
  }
  if (candidates.length === 0) return undefined;

  // An exact title match beats a popular near-miss. Somebody typing "Andor"
  // means Andor, not the better-known thing that mentions it in a subtitle.
  const typed = query.trim().toLowerCase();
  const exact = candidates.filter((c) => c.name.toLowerCase() === typed);
  const pool = exact.length > 0 ? exact : candidates;
  const { popularity: _p, ...title } = pool.sort((a, b) => b.popularity - a.popularity)[0];
  return title;
}

const yearOf = (date: string | undefined) => {
  const year = Number(date?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
};

/** Flatrate covers subscription streaming. `free` and `ads` are watchable at no
 *  cost to the family, so they count as having it, and they are named as such. */
const subscriptionOffers = (slice: TmdbCountryWatchProviders): TmdbWatchProviderOffer[] =>
  [...(slice.flatrate ?? []), ...(slice.free ?? []), ...(slice.ads ?? [])].filter(
    (o) => !isLiveTvBundle(o.provider_name),
  );

const uniqueNames = (offers: TmdbWatchProviderOffer[]) => [
  ...new Set(offers.map((o) => o.provider_name)),
];

export interface LookupDeps {
  client: TmdbClient;
  catalog: Catalog;
}

/**
 * Answer one typed title. One search pair, one provider call, no season fan-out.
 *
 * Never throws on a source failure. Every way TMDB can decline to answer lands
 * on `unknown` with a reason, because the caller's job is to render the
 * difference between "nothing carries this" and "we could not find out".
 */
export async function lookupShow({ client, catalog }: LookupDeps, query: string): Promise<Lookup> {
  const trimmed = query.trim();
  if (trimmed === '') return { status: 'no-match', query: trimmed };

  const title = await resolveTitle(client, trimmed);
  if (title === 'error') {
    return { status: 'unknown', query: trimmed, reason: 'TMDB did not answer the search' };
  }
  if (!title) return { status: 'no-match', query: trimmed };

  const providers: TmdbResult<{ results: Record<string, TmdbCountryWatchProviders> }> =
    title.kind === 'series'
      ? await client.getTvWatchProviders(title.tmdbId)
      : await client.getMovieWatchProviders(title.tmdbId);

  if (providers.kind === 'error') {
    return { status: 'unknown', title, query: trimmed, reason: 'TMDB did not answer' };
  }
  // A 404 or an empty body is a fact about TMDB. It is not a claim that nothing
  // carries the title, and the type here refuses to let it become one.
  if (providers.kind === 'not_found' || providers.kind === 'empty') {
    return { status: 'unknown', title, query: trimmed, reason: 'TMDB holds no provider record' };
  }

  const slice = providers.data.results[catalog.country];
  if (!slice) {
    return {
      status: 'unknown',
      title,
      query: trimmed,
      reason: `TMDB answered, with nothing for ${catalog.country}`,
    };
  }

  const justwatchLink = slice.link;
  const streaming = subscriptionOffers(slice);
  const rentOrBuyOn = uniqueNames([...(slice.rent ?? []), ...(slice.buy ?? [])]);

  if (streaming.length === 0) {
    if (rentOrBuyOn.length === 0) return { status: 'unavailable', title, justwatchLink };
    return { status: 'need-it', title, paths: [], unpriced: [], rentOrBuyOn, justwatchLink };
  }

  const matched = new Map<string, Service>();
  const unmatched: string[] = [];
  for (const name of uniqueNames(streaming)) {
    const service = matchService(catalog.services, name);
    if (service) matched.set(service.id, service);
    else unmatched.push(name);
  }

  // Paused does not mean held. A paused row buys nobody access today, which is
  // the whole reason the toggle above has to be honest about what it changed.
  const active = activeSubscriptions(catalog);
  const heldBy: HeldBy[] = [...matched.values()]
    .map((service) => ({
      service,
      households: active
        .filter((s) => s.serviceId === service.id)
        .map((s) => catalog.households.find((h) => h.id === s.householdId)!)
        .filter(Boolean),
    }))
    .filter((h) => h.households.length > 0);

  if (heldBy.length > 0) {
    const covering = new Set(heldBy.map((h) => h.service.id));
    return {
      status: 'have-it',
      title,
      heldBy,
      alsoOn: [
        ...[...matched.values()].filter((s) => !covering.has(s.id)).map((s) => s.name),
        ...unmatched,
      ],
      justwatchLink,
    };
  }

  const paths = [...matched.values()]
    .map((service) => pathFor(catalog, service))
    .sort(
      (a, b) =>
        a.monthlyCost - b.monthlyCost ||
        Number(b.resumes !== undefined) - Number(a.resumes !== undefined),
    );

  return { status: 'need-it', title, paths, unpriced: unmatched, rentOrBuyOn, justwatchLink };
}
