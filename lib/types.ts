/** Core domain types. Deliberately free of any storage or framework concern. */

export type PersonId = string;
export type HouseholdId = string;
export type ServiceId = string;
export type TitleId = string;

/** Month index across the planning horizon, 0 = the first month of the plan. */
export type MonthIndex = number;

export interface Person {
  id: PersonId;
  name: string;
  householdId: HouseholdId;
}

export interface Household {
  id: HouseholdId;
  name: string;
  /** Where the household lives. Household enforcement is geographic, so this matters. */
  location: string;
}

/**
 * What sharing a provider actually permits. The product never recommends a plan
 * that violates this, because a recommendation that gets an account locked costs
 * more trust than it saves money.
 */
export type SharingPolicy =
  | 'household-only' // one roof, enforced by IP and device
  | 'extra-member' // additional member can be bought for an outside household
  | 'two-adults'; // e.g. an Amazon-style household of two adults

/**
 * How a provider lets a household stop paying. The product's verb is pause, but
 * only some providers sell one, and flattening the difference would make the app
 * lie at the exact moment it asks somebody to press a button.
 */
export type PauseMethod =
  | 'native-pause' // billing stops, the account and its history survive
  | 'cancel-resubscribe' // no pause exists, so stopping means cancelling
  | 'store-managed'; // bought through a channel store, stopped from one account

/**
 * What pausing costs beyond the money. These are the reasons somebody refuses to
 * press the button, so the app has to know them per service rather than assume
 * the only cost is the price.
 */
export type PauseCost =
  | 'downloads' // offline copies go
  | 'watch-list' // saved list does not survive
  | 'profiles' // profiles and their per-person history go
  | 'grandfathered-price' // resuming costs more than the household pays now
  | 'annual-term-forfeit'; // stopping mid-term forfeits the rest of the year

/**
 * What the family learned by walking one provider's flow by hand. Recorded, not
 * inferred: no API reports any of this, so a person clicked through and wrote it
 * down, and `verifiedOn` is how the app knows when to doubt the record.
 */
export interface PauseTerms {
  method: PauseMethod;
  /** The deep link that actually reaches the stop-billing page. */
  manageUrl: string;
  /** Longest pause the provider allows, in months. Native pause only. */
  maxPauseMonths?: number;
  /** Empty means the walkthrough found nothing lost, not that nobody checked. */
  costs: PauseCost[];
  /** ISO date somebody last walked this flow. */
  verifiedOn: string;
}

export interface Service {
  id: ServiceId;
  name: string;
  /** Standard ad-free monthly price in USD. Illustrative figures, not scraped. */
  monthlyPrice: number;
  sharingPolicy: SharingPolicy;
  /** Cost of adding an out-of-household member, where the provider sells one. */
  extraMemberPrice?: number;
  /**
   * Absent means nobody has walked this provider's flow yet. The app says so
   * rather than offering a button it cannot stand behind.
   */
  pause?: PauseTerms;
}

export type BillingCycle = 'monthly' | 'annual';

/**
 * Paused is a state, not a deletion. A paused row keeps its history and its spend
 * record, because the household expects to come back and the trend needs it.
 */
export type SubscriptionStatus = 'active' | 'paused';

export interface Subscription {
  id: string;
  serviceId: ServiceId;
  householdId: HouseholdId;
  payerId: PersonId;
  /** What this household actually pays per month, after any annual discount. */
  monthlyCost: number;
  billingCycle: BillingCycle;
  /** ISO date of the next renewal. Meaningless while paused. */
  renewsOn: string;
  /** Absent means active. Rows written before pausing existed stay valid. */
  status?: SubscriptionStatus;
  /** ISO date billing stopped. Paused rows only. */
  pausedOn?: string;
  /**
   * ISO date the service is due back. The app owns this date, because a pause
   * nobody lifts is how a household loses a show mid-season.
   */
  resumeBy?: string;
  /**
   * ISO date somebody in the household last watched anything here, as reported
   * by the family. No viewing history is ingested, so this is self-declared and
   * absent means nobody has answered yet, never "never watched".
   */
  lastUsedOn?: string;
}

export type TitleKind = 'series' | 'film';

export interface Title {
  id: TitleId;
  name: string;
  year: number;
  kind: TitleKind;
  /**
   * The month the family intends to watch this. This is the demand plan, and it
   * is what turns a wish list into a schedule.
   */
  plannedMonth: MonthIndex;
}

/** One person wanting one title. Interest count drives priority. */
export interface Interest {
  titleId: TitleId;
  personId: PersonId;
}

export type OfferKind = 'flatrate' | 'rent' | 'buy';

/** A way to watch a title on a given service. */
export interface Offer {
  serviceId: ServiceId;
  kind: OfferKind;
  /**
   * Transactional price for rent and buy. Undefined means the source could not
   * supply one, which is exactly the gap TMDB leaves and Watchmode fills.
   */
  price?: number;
}

/* --------------------------------------------------------------------------
 * The availability seam.
 *
 * Vendor-neutral by construction. Nothing below names a vendor, an endpoint or
 * a vendor's id space. An adapter for TMDB and an adapter for movieofthenight
 * satisfy the same shape.
 * ----------------------------------------------------------------------- */

/** ISO 3166-1 alpha-2. Availability is a per-country fact, never a global one. */
export type CountryCode = string;

/** A season as the *source* numbers them. Sources disagree, which is the point. */
export type SeasonNumber = number;

/**
 * Why a source could not confirm. None of these mean "not available". A source
 * that answers with nothing has told us about itself, not about the title.
 */
export type UnknownReason =
  | 'not-queried' // nobody asked, or the season fan-out was skipped to save quota
  | 'not-found' // the source has no record of this title or season
  | 'empty' // the source answered, and the answer was blank
  | 'source-error'; // transport failed, quota ran out or the payload was malformed

/**
 * What a source knows about one set of offers. Three states, never two.
 *
 * `available` carries at least one offer. `unavailable` is a positive claim that
 * nothing carries the title, and deliberately has no `offers` field, so an empty
 * array can never be mistaken for it. `unknown` is the third state and callers
 * cannot read offers off it without narrowing first. That is the enforcement:
 * unknown does not degrade to `[]` or `null` because the type has no such door.
 */
export type OfferSet =
  | { status: 'available'; offers: readonly Offer[] }
  | { status: 'unavailable' }
  | { status: 'unknown'; reason: UnknownReason };

/** What a source knows about one season. */
export interface SeasonAvailability {
  season: SeasonNumber;
  offers: OfferSet;
}

/**
 * Per-season detail. Films take `not-applicable`, which is how the design avoids
 * threading a "has seasons" flag through every call site.
 */
export type SeasonBreakdown =
  | { status: 'resolved'; seasons: readonly SeasonAvailability[] }
  | { status: 'not-applicable' }
  | { status: 'unknown'; reason: UnknownReason };

/**
 * One title's availability in one country.
 *
 * `series` and `seasons` are held apart on purpose and no code path may collapse
 * one into the other. For a series, `series` is the source's union across every
 * season - the value that hides a mid-series provider split. Reading it alone is
 * how a rotation plan strands somebody in the middle of season four.
 */
export interface TitleAvailability {
  titleId: TitleId;
  kind: TitleKind;
  country: CountryCode;
  /** The whole-title answer. A union across seasons, for a series. */
  series: OfferSet;
  /** The per-season answer. Never derived from `series`. */
  seasons: SeasonBreakdown;
  /** ISO 8601 instant the source answered. Freshness is computed from this. */
  observedAt: string;
  /** Vendor-neutral name of whatever answered, for audit. */
  source: string;
}

/** How much detail the caller wants, and is willing to spend requests on. */
export type AvailabilityDetail =
  /** The whole-title answer alone. One request per title. */
  | 'series-only'
  /**
   * Fan out to seasons too. Costs a request per season, so ask for it only for
   * titles somebody actually plans to watch.
   */
  | 'with-seasons';

export interface AvailabilityRequest {
  titleId: TitleId;
  /** Films have no seasons. The provider needs this to know what to ask for. */
  kind: TitleKind;
  country: CountryCode;
  detail: AvailabilityDetail;
}

/**
 * The seam. A fixture implementation ships today; a network-backed adapter drops
 * in behind it without the domain logic noticing.
 *
 * Async because no honest network- or cache-backed source is synchronous. One
 * method, because no source worth adapting has a batch endpoint for this and a
 * provider that wants to pipeline can queue internally.
 *
 * Implementations never throw for a title they cannot resolve. They return
 * `unknown` with a reason. Throwing is reserved for programmer error.
 */
export interface AvailabilityProvider {
  /** Vendor-neutral name, recorded on every answer this provider returns. */
  readonly name: string;
  availabilityFor(request: AvailabilityRequest): Promise<TitleAvailability>;
}

/**
 * How much to trust an answer. `stale` is a function of `observedAt` and a
 * threshold the reader owns, so no adapter can flatter its own data.
 */
export type Confidence = 'confirmed' | 'stale' | 'unknown';

/**
 * A way the series union and the season detail disagree. Every one of these is
 * a real signal rather than noise: it catches a partial catalogue, and it catches
 * a source numbering seasons in production order while the platform numbers them
 * in streaming order.
 */
export type DiscrepancyKind =
  | 'series-only' // the union names a service that no resolved season names
  | 'season-only' // a season names a service the union omits
  | 'partial-seasons'; // a service carries some resolved seasons but not all

/** One service's flatrate reach across the seasons that resolved. */
export interface SeasonCoverage {
  serviceId: ServiceId;
  /** Resolved seasons this service carries. */
  carries: SeasonNumber[];
  /** Resolved seasons it does not. Non-empty here is the sequencing risk. */
  missing: SeasonNumber[];
}

export interface Discrepancy extends SeasonCoverage {
  kind: DiscrepancyKind;
}

/**
 * The comparison of the union against the seasons. Derived, never supplied by an
 * adapter, so an adapter cannot forget to compute it and cannot lie about it.
 *
 * Scoped to flatrate offers. Rotation is a subscription question, and no source
 * publishes rent or buy offers per season, so comparing them would manufacture
 * disagreement out of a gap.
 */
export interface Reconciliation {
  /** Echoes the breakdown, so callers know whether the comparison ran at all. */
  seasonDetail: SeasonBreakdown['status'];
  coverage: SeasonCoverage[];
  discrepancies: Discrepancy[];
  /** Seasons the source could not confirm. Any whole-series claim is unsafe. */
  unresolvedSeasons: SeasonNumber[];
}
