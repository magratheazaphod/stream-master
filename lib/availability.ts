/**
 * The availability module: the pure helpers every reader of the seam needs, and
 * the fixture implementation that ships today.
 *
 * Nothing here knows a vendor. A network-backed adapter lands beside the mock and
 * imports the same helpers.
 */

import type {
  AvailabilityProvider,
  AvailabilityRequest,
  Confidence,
  Discrepancy,
  Offer,
  OfferSet,
  Reconciliation,
  SeasonAvailability,
  SeasonBreakdown,
  SeasonCoverage,
  SeasonNumber,
  ServiceId,
  TitleAvailability,
  TitleId,
  UnknownReason,
} from './types';

/* -- Constructors. Use these rather than building the unions by hand. -------- */

/** An offer set from a list. An empty list is `unavailable`, never `available`. */
export function offerSet(offers: readonly Offer[]): OfferSet {
  return offers.length > 0
    ? { status: 'available', offers }
    : { status: 'unavailable' };
}

export function unknownOffers(reason: UnknownReason): OfferSet {
  return { status: 'unknown', reason };
}

export function unknownSeasons(reason: UnknownReason): SeasonBreakdown {
  return { status: 'unknown', reason };
}

/** Offers a caller may read, or an empty list. Only ever call after checking status. */
export function offersOf(set: OfferSet): readonly Offer[] {
  return set.status === 'available' ? set.offers : [];
}

/* -- Freshness -------------------------------------------------------------- */

/** A week. Availability churns on a scale of weeks, so this is a real threshold. */
export const DEFAULT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Confidence in the whole-title answer.
 *
 * A gap in the season detail does not downgrade this. That gap is reported on its
 * own as `unresolvedSeasons`, and folding the two together would let a missing
 * season quietly discredit a union we do trust.
 */
export function confidenceOf(
  a: TitleAvailability,
  now: Date,
  freshnessMs = DEFAULT_FRESHNESS_MS,
): Confidence {
  if (a.series.status === 'unknown') return 'unknown';
  const age = now.getTime() - new Date(a.observedAt).getTime();
  return age > freshnessMs ? 'stale' : 'confirmed';
}

/* -- Reconciliation --------------------------------------------------------- */

const flatrateServices = (set: OfferSet): Set<ServiceId> =>
  new Set(
    offersOf(set)
      .filter((o) => o.kind === 'flatrate')
      .map((o) => o.serviceId),
  );

/** A season counts as resolved when the source made a claim either way. */
const resolved = (s: SeasonAvailability) => s.offers.status !== 'unknown';

/**
 * Compare the union against the seasons and name every way they disagree.
 *
 * The comparison runs only against seasons that resolved. Treating an unconfirmed
 * season as a disagreement would invent a signal out of an absence, which is the
 * same error as reading unknown as unavailable.
 */
export function reconcile(a: TitleAvailability): Reconciliation {
  const breakdown = a.seasons;
  if (breakdown.status !== 'resolved') {
    return {
      seasonDetail: breakdown.status,
      coverage: [],
      discrepancies: [],
      unresolvedSeasons: [],
    };
  }

  const unresolvedSeasons = breakdown.seasons
    .filter((s) => !resolved(s))
    .map((s) => s.season);
  const known = breakdown.seasons.filter(resolved);
  if (known.length === 0) {
    // Nothing resolved, so there is nothing to compare the union against.
    return { seasonDetail: 'resolved', coverage: [], discrepancies: [], unresolvedSeasons };
  }

  const perSeason = known.map((s) => ({
    season: s.season,
    services: flatrateServices(s.offers),
  }));

  const seriesKnown = a.series.status !== 'unknown';
  const seriesServices = flatrateServices(a.series);

  const everyService = new Set<ServiceId>([
    ...seriesServices,
    ...perSeason.flatMap((s) => [...s.services]),
  ]);

  const coverage: SeasonCoverage[] = [...everyService]
    .map((serviceId) => ({
      serviceId,
      carries: perSeason.filter((s) => s.services.has(serviceId)).map((s) => s.season),
      missing: perSeason.filter((s) => !s.services.has(serviceId)).map((s) => s.season),
    }))
    .sort((x, y) => x.serviceId.localeCompare(y.serviceId));

  const discrepancies: Discrepancy[] = [];
  for (const c of coverage) {
    const inUnion = seriesServices.has(c.serviceId);
    // With an unknown union there is nothing to disagree with, so only the
    // within-seasons split is a finding.
    if (seriesKnown && !inUnion) {
      discrepancies.push({ ...c, kind: 'season-only' });
    } else if (seriesKnown && inUnion && c.carries.length === 0) {
      discrepancies.push({ ...c, kind: 'series-only' });
    } else if (c.carries.length > 0 && c.missing.length > 0) {
      discrepancies.push({ ...c, kind: 'partial-seasons' });
    }
  }

  return { seasonDetail: 'resolved', coverage, discrepancies, unresolvedSeasons };
}

/** The answer for a title nobody has looked up yet. Unknown, with a reason. */
export function unresolvedAvailability(
  request: AvailabilityRequest,
  source: string,
  observedAt: string,
  reason: UnknownReason = 'not-queried',
): TitleAvailability {
  return {
    titleId: request.titleId,
    kind: request.kind,
    country: request.country,
    series: unknownOffers(reason),
    seasons:
      request.kind === 'film' ? { status: 'not-applicable' } : unknownSeasons(reason),
    observedAt,
    source,
  };
}

/* -- The fixture implementation --------------------------------------------- */

/**
 * A title in the fixture table. `series` omitted makes the whole title unknown,
 * which is the case the interface exists to keep honest. A bare array is
 * shorthand for a series-level answer with no season detail.
 */
export interface MockTitleFixture {
  series?: Offer[];
  /** Keyed by season number. A season mapped to `null` resolved to nothing. */
  seasons?: Record<SeasonNumber, Offer[] | null>;
  /** ISO 8601. Defaults to now, so fixtures read as confirmed. */
  observedAt?: string;
}

export type MockTable = Record<TitleId, Offer[] | MockTitleFixture>;

/**
 * Fixture-backed availability. Ships today so the seam is real without an API key
 * or a vendor decision.
 *
 * The table is always supplied by the caller. There is no default, because a
 * default would be a second door onto the demo dataset and `lib/catalog.ts` is
 * the only place allowed to choose which dataset the app runs on.
 *
 * The one semantic worth stating: a title missing from the table comes back
 * unknown, not empty. A mock that answered "no offers" for anything it had never
 * heard of would teach every consumer the exact habit this seam forbids.
 */
export class MockAvailabilityProvider implements AvailabilityProvider {
  readonly name = 'fixtures';

  constructor(private readonly table: MockTable) {}

  async availabilityFor(request: AvailabilityRequest): Promise<TitleAvailability> {
    const now = new Date().toISOString();
    const entry = this.table[request.titleId];
    if (!entry) return unresolvedAvailability(request, this.name, now, 'not-found');

    const fixture: MockTitleFixture = Array.isArray(entry) ? { series: entry } : entry;
    const observedAt = fixture.observedAt ?? now;

    return {
      titleId: request.titleId,
      kind: request.kind,
      country: request.country,
      series: fixture.series ? offerSet(fixture.series) : unknownOffers('empty'),
      seasons: seasonBreakdown(request, fixture),
      observedAt,
      source: this.name,
    };
  }
}

function seasonBreakdown(
  request: AvailabilityRequest,
  fixture: MockTitleFixture,
): TitleAvailability['seasons'] {
  if (request.kind === 'film') return { status: 'not-applicable' };
  if (request.detail === 'series-only') return unknownSeasons('not-queried');
  if (!fixture.seasons) return unknownSeasons('empty');

  const seasons: SeasonAvailability[] = Object.entries(fixture.seasons)
    .map(([n, offers]) => ({
      season: Number(n),
      offers: offers === null ? unknownOffers('empty') : offerSet(offers),
    }))
    .sort((a, b) => a.season - b.season);

  return { status: 'resolved', seasons };
}

/**
 * The real implementations slot in beside this one, and `lib/catalog.ts` picks.
 *
 * TMDB returns which providers carry a title per region, split into flatrate,
 * rent and buy, but it does not return transactional prices. Every rent and buy
 * offer it produces will have `price` undefined, which the UI already handles.
 *
 * Watchmode returns prices. That is the entire reason to pay for it.
 */
