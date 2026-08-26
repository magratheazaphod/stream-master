/**
 * The demo dataset. This file is committed and public, and every household,
 * person, price and subscription in it is invented.
 *
 * Never put real data here. Real household data lives in `data/family.json`,
 * which is gitignored and never enters the repository. `getCatalog` in
 * `lib/catalog.ts` loads that file when it exists and falls back to this one
 * when it does not, so switching datasets costs no code change. Editing this
 * file to hold a real family is the one thing that breaks the guarantee.
 *
 * Prices are illustrative US ad-free monthly rates, not scraped from providers.
 */

import type { MockTable } from './availability';
import type {
  Household,
  Interest,
  Person,
  Service,
  Subscription,
  Title,
} from './types';

export const households: Household[] = [
  { id: 'h-north', name: 'Northgate', location: 'Northgate, CA' },
  { id: 'h-river', name: 'Riverbend', location: 'Riverbend, IL' },
  { id: 'h-fair', name: 'Fairhaven', location: 'Fairhaven, MA' },
  { id: 'h-king', name: 'Kingsbridge', location: 'Kingsbridge, UK' },
];

export const people: Person[] = [
  { id: 'p-1', name: 'Avery', householdId: 'h-north' },
  { id: 'p-2', name: 'Quinn', householdId: 'h-north' },
  { id: 'p-3', name: 'Marta', householdId: 'h-river' },
  { id: 'p-4', name: 'Alan', householdId: 'h-river' },
  { id: 'p-5', name: 'Nina', householdId: 'h-fair' },
  { id: 'p-6', name: 'Ravi', householdId: 'h-fair' },
  { id: 'p-7', name: 'Priya', householdId: 'h-king' },
  { id: 'p-8', name: 'Tom', householdId: 'h-king' },
];

/**
 * Pause terms are invented here, but their *shape* is the real constraint: no
 * provider reports any of this, so every field is something a person recorded by
 * walking the flow. The four cases below are the four the UI has to survive.
 *
 * - Hulu sells a real pause with a ceiling on it
 * - Netflix, Max, Disney+ and Apple TV+ have no pause, so stopping means
 *   cancelling, and each loses something different
 * - Paramount+ is bought through a channel store and stops from one account
 * - Prime Video has no terms recorded at all, which is not the same as free
 *
 * `manageUrl` and `method` here are what a playbook in `cowork/` will act on, so
 * each one that has not been walked says so at the top of its playbook. Netflix's
 * deep link and Hulu's pause are the two settled cases. The rest are illustrative
 * and a walkthrough rewrites them with a fresh `verifiedOn`.
 */
export const services: Service[] = [
  {
    id: 's-netflix', name: 'Netflix', monthlyPrice: 17.99,
    sharingPolicy: 'household-only', extraMemberPrice: 7.99,
    pause: {
      method: 'cancel-resubscribe',
      manageUrl: 'https://www.netflix.com/cancelplan',
      costs: ['profiles', 'downloads'],
      verifiedOn: '2026-07-18',
    },
  },
  {
    id: 's-max', name: 'Max', monthlyPrice: 16.99, sharingPolicy: 'household-only',
    pause: {
      method: 'cancel-resubscribe',
      manageUrl: 'https://auth.max.com/account/subscription',
      costs: ['downloads', 'watch-list'],
      verifiedOn: '2026-07-18',
    },
  },
  {
    id: 's-disney', name: 'Disney+', monthlyPrice: 9.99,
    sharingPolicy: 'household-only', extraMemberPrice: 6.99,
    pause: {
      method: 'cancel-resubscribe',
      manageUrl: 'https://www.disneyplus.com/account/subscription',
      // Resuming lands on the current rate, and this household is below it.
      costs: ['grandfathered-price'],
      verifiedOn: '2026-07-19',
    },
  },
  {
    id: 's-hulu', name: 'Hulu', monthlyPrice: 9.99, sharingPolicy: 'household-only',
    // The good case, and the only one where the verb is literally true.
    pause: {
      method: 'native-pause',
      manageUrl: 'https://secure.hulu.com/account',
      // The provider states the ceiling in weeks, so three months is the floor of
      // twelve weeks, not a round number somebody chose. Rounding it up would
      // produce a resume date the provider will not honour.
      maxPauseMonths: 3,
      costs: [],
      verifiedOn: '2026-07-19',
    },
  },
  {
    id: 's-appletv', name: 'Apple TV+', monthlyPrice: 9.99, sharingPolicy: 'household-only',
    pause: {
      method: 'cancel-resubscribe',
      manageUrl: 'https://apps.apple.com/account/subscriptions',
      // The Northgate row is annual, so stopping early throws the rest away.
      costs: ['annual-term-forfeit', 'downloads'],
      verifiedOn: '2026-07-20',
    },
  },
  {
    id: 's-paramount', name: 'Paramount+', monthlyPrice: 7.99, sharingPolicy: 'household-only',
    // Bought as a Prime Video channel, so it stops where every other channel does.
    pause: {
      method: 'store-managed',
      manageUrl: 'https://www.amazon.com/gp/video/settings/subscriptions',
      costs: [],
      verifiedOn: '2026-07-20',
    },
  },
  {
    id: 's-peacock', name: 'Peacock', monthlyPrice: 7.99, sharingPolicy: 'household-only',
    // The second native-pause case, so the UI never renders that branch off one
    // row. Nobody has walked it: `cowork/peacock-pause.md` refuses to act until
    // somebody confirms a pause exists here at all.
    pause: {
      method: 'native-pause',
      manageUrl: 'https://www.peacocktv.com/account/plans',
      maxPauseMonths: 2,
      costs: [],
      verifiedOn: '2026-07-21',
    },
  },
  {
    id: 's-prime', name: 'Prime Video', monthlyPrice: 8.99, sharingPolicy: 'two-adults',
    // No `pause` on purpose. Nobody has walked this one, and the app has to offer
    // no button rather than a guess. Absent terms are a gap, never a green light.
  },
];

/**
 * Every state the pause flow has to render, forced into twelve rows:
 *
 * - an active service nobody has watched in five months (sub-2, the headline)
 * - a pause running normally, due back next month (sub-5)
 * - a pause whose resume date has already passed (sub-12, the alarm)
 * - an annual row whose pause forfeits the term (sub-3)
 * - a row nobody has answered the usage question for (sub-9)
 * - a duplicate where one copy is already paused (Max, three households)
 */
export const subscriptions: Subscription[] = [
  { id: 'sub-1', serviceId: 's-netflix', householdId: 'h-north', payerId: 'p-1', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-14', status: 'active', lastUsedOn: '2026-07-24' },
  // Five months of nobody watching, still billing. The reason this product exists.
  { id: 'sub-2', serviceId: 's-max', householdId: 'h-north', payerId: 'p-2', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-02', status: 'active', lastUsedOn: '2026-02-10' },
  { id: 'sub-3', serviceId: 's-appletv', householdId: 'h-north', payerId: 'p-1', monthlyCost: 8.32, billingCycle: 'annual', renewsOn: '2027-01-19', status: 'active', lastUsedOn: '2026-06-30' },

  { id: 'sub-4', serviceId: 's-netflix', householdId: 'h-river', payerId: 'p-3', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-21', status: 'active', lastUsedOn: '2026-07-25' },
  // Paused deliberately and coming back for the next season. The happy path.
  { id: 'sub-5', serviceId: 's-max', householdId: 'h-river', payerId: 'p-4', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-09', status: 'paused', pausedOn: '2026-06-01', resumeBy: '2026-09-01', lastUsedOn: '2026-05-28' },
  { id: 'sub-6', serviceId: 's-hulu', householdId: 'h-river', payerId: 'p-3', monthlyCost: 9.99, billingCycle: 'monthly', renewsOn: '2026-08-28', status: 'active', lastUsedOn: '2026-07-19' },

  { id: 'sub-7', serviceId: 's-netflix', householdId: 'h-fair', payerId: 'p-5', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-05', status: 'active', lastUsedOn: '2026-07-11' },
  { id: 'sub-8', serviceId: 's-disney', householdId: 'h-fair', payerId: 'p-6', monthlyCost: 9.99, billingCycle: 'monthly', renewsOn: '2026-08-17', status: 'active', lastUsedOn: '2026-04-02' },
  // No `lastUsedOn`: nobody in Fairhaven has answered. Not the same as unused.
  { id: 'sub-9', serviceId: 's-paramount', householdId: 'h-fair', payerId: 'p-5', monthlyCost: 6.66, billingCycle: 'annual', renewsOn: '2026-11-30', status: 'active' },

  { id: 'sub-10', serviceId: 's-netflix', householdId: 'h-king', payerId: 'p-7', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-11', status: 'active', lastUsedOn: '2026-07-22' },
  { id: 'sub-11', serviceId: 's-prime', householdId: 'h-king', payerId: 'p-8', monthlyCost: 8.99, billingCycle: 'monthly', renewsOn: '2026-08-23', status: 'active', lastUsedOn: '2026-07-15' },
  // Due back in June and still off in late July. Somebody is missing a season.
  { id: 'sub-12', serviceId: 's-max', householdId: 'h-king', payerId: 'p-7', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-26', status: 'paused', pausedOn: '2026-03-15', resumeBy: '2026-06-15', lastUsedOn: '2026-03-09' },
];

export const titles: Title[] = [
  { id: 't-1', name: 'Severance', year: 2025, kind: 'series', plannedMonth: 0 },
  { id: 't-2', name: 'The Last of Us', year: 2025, kind: 'series', plannedMonth: 2 },
  { id: 't-3', name: 'The Bear', year: 2026, kind: 'series', plannedMonth: 1 },
  { id: 't-4', name: 'Dune: Part Two', year: 2024, kind: 'film', plannedMonth: 0 },
  { id: 't-5', name: 'Shogun', year: 2024, kind: 'series', plannedMonth: 4 },
  { id: 't-6', name: 'Andor', year: 2025, kind: 'series', plannedMonth: 3 },
  { id: 't-7', name: 'Poor Things', year: 2023, kind: 'film', plannedMonth: 5 },
  { id: 't-8', name: 'Slow Horses', year: 2026, kind: 'series', plannedMonth: 6 },
  { id: 't-9', name: 'Ripley', year: 2024, kind: 'series', plannedMonth: 7 },
  { id: 't-10', name: 'The Brutalist', year: 2024, kind: 'film', plannedMonth: 8 },
];

export const interests: Interest[] = [
  { titleId: 't-1', personId: 'p-1' }, { titleId: 't-1', personId: 'p-3' },
  { titleId: 't-1', personId: 'p-5' }, { titleId: 't-1', personId: 'p-7' },

  { titleId: 't-2', personId: 'p-2' }, { titleId: 't-2', personId: 'p-4' },
  { titleId: 't-2', personId: 'p-5' }, { titleId: 't-2', personId: 'p-6' },
  { titleId: 't-2', personId: 'p-8' },

  { titleId: 't-3', personId: 'p-1' }, { titleId: 't-3', personId: 'p-2' },
  { titleId: 't-3', personId: 'p-6' },

  { titleId: 't-4', personId: 'p-4' }, { titleId: 't-4', personId: 'p-8' },

  { titleId: 't-5', personId: 'p-3' }, { titleId: 't-5', personId: 'p-5' },
  { titleId: 't-5', personId: 'p-7' },

  { titleId: 't-6', personId: 'p-6' }, { titleId: 't-6', personId: 'p-2' },

  { titleId: 't-7', personId: 'p-7' },

  { titleId: 't-8', personId: 'p-1' }, { titleId: 't-8', personId: 'p-3' },
  { titleId: 't-8', personId: 'p-8' },

  { titleId: 't-9', personId: 'p-5' },

  { titleId: 't-10', personId: 'p-2' }, { titleId: 't-10', personId: 'p-4' },
];

/**
 * Stand-in for a real availability feed. Every awkward case a real source throws
 * is forced here, because a mock that only produces clean data lets consumers
 * quietly assume clean data:
 *
 * - a rent offer with no price, which is exactly what TMDB returns
 * - a service in the series union that carries only some seasons (Shogun)
 * - a season the source could not confirm (Andor)
 * - a service in the union that no season names (Slow Horses)
 * - a title the source has never heard of (The Brutalist)
 */
export const demoAvailability: MockTable = {
  't-1': {
    series: [{ serviceId: 's-appletv', kind: 'flatrate' }],
    seasons: {
      1: [{ serviceId: 's-appletv', kind: 'flatrate' }],
      2: [{ serviceId: 's-appletv', kind: 'flatrate' }],
    },
  },
  't-2': {
    series: [
      { serviceId: 's-max', kind: 'flatrate' },
      { serviceId: 's-prime', kind: 'buy', price: 24.99 },
    ],
    seasons: {
      1: [{ serviceId: 's-max', kind: 'flatrate' }],
      2: [{ serviceId: 's-max', kind: 'flatrate' }],
    },
  },
  't-3': {
    series: [
      { serviceId: 's-hulu', kind: 'flatrate' },
      { serviceId: 's-prime', kind: 'rent', price: 3.99 },
    ],
    seasons: {
      1: [{ serviceId: 's-hulu', kind: 'flatrate' }],
      2: [{ serviceId: 's-hulu', kind: 'flatrate' }],
      3: [{ serviceId: 's-hulu', kind: 'flatrate' }],
    },
  },
  't-4': [
    { serviceId: 's-max', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'rent', price: 4.99 },
    { serviceId: 's-appletv', kind: 'buy', price: 14.99 },
  ],
  // The split the whole product turns on. The union names Hulu, but Hulu drops
  // after season one, so a plan built on the union strands a viewer mid-series.
  't-5': {
    series: [
      { serviceId: 's-hulu', kind: 'flatrate' },
      { serviceId: 's-disney', kind: 'flatrate' },
    ],
    seasons: {
      1: [
        { serviceId: 's-hulu', kind: 'flatrate' },
        { serviceId: 's-disney', kind: 'flatrate' },
      ],
      2: [{ serviceId: 's-disney', kind: 'flatrate' }],
    },
  },
  // Season two came back blank. Unknown, which is not the same as unavailable.
  't-6': {
    series: [{ serviceId: 's-disney', kind: 'flatrate' }],
    seasons: {
      1: [{ serviceId: 's-disney', kind: 'flatrate' }],
      2: null,
    },
  },
  't-7': [
    { serviceId: 's-hulu', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'rent' }, // price unknown, as TMDB would leave it
  ],
  // Prime sits in the union and in none of the seasons: a stale union entry, or
  // the source numbering seasons differently from the platform.
  't-8': {
    series: [
      { serviceId: 's-appletv', kind: 'flatrate' },
      { serviceId: 's-prime', kind: 'flatrate' },
    ],
    seasons: {
      1: [{ serviceId: 's-appletv', kind: 'flatrate' }],
      2: [{ serviceId: 's-appletv', kind: 'flatrate' }],
      3: [{ serviceId: 's-appletv', kind: 'flatrate' }],
      4: [{ serviceId: 's-appletv', kind: 'flatrate' }],
    },
  },
  't-9': {
    series: [{ serviceId: 's-netflix', kind: 'flatrate' }],
    seasons: { 1: [{ serviceId: 's-netflix', kind: 'flatrate' }] },
  },
  // 't-10' is absent on purpose. The source has never heard of it, so the app has
  // to say so rather than call it unavailable.
};
