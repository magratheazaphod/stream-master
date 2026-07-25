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

export interface Service {
  id: ServiceId;
  name: string;
  /** Standard ad-free monthly price in USD. Illustrative figures, not scraped. */
  monthlyPrice: number;
  sharingPolicy: SharingPolicy;
  /** Cost of adding an out-of-household member, where the provider sells one. */
  extraMemberPrice?: number;
}

export type BillingCycle = 'monthly' | 'annual';

export interface Subscription {
  id: string;
  serviceId: ServiceId;
  householdId: HouseholdId;
  payerId: PersonId;
  /** What this household actually pays per month, after any annual discount. */
  monthlyCost: number;
  billingCycle: BillingCycle;
  /** ISO date of the next renewal. */
  renewsOn: string;
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

/**
 * The seam. A mock implementation ships today; TMDB or Watchmode drops in behind
 * this interface without the domain logic noticing.
 */
export interface AvailabilityProvider {
  offersFor(titleId: TitleId): Offer[];
}
