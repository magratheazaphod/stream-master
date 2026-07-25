/**
 * Fixtures. Every name, price and subscription here is invented so the interface
 * has something to render. Replace this file with real family data - nothing else
 * needs to change.
 *
 * Prices are illustrative US ad-free monthly rates, not scraped from providers.
 */

import type {
  Household,
  Interest,
  Offer,
  Person,
  Service,
  Subscription,
  Title,
} from './types';

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export const households: Household[] = [
  { id: 'h-oak', name: 'Oakland', location: 'Oakland, CA' },
  { id: 'h-chi', name: 'Chicago', location: 'Chicago, IL' },
  { id: 'h-bos', name: 'Boston', location: 'Boston, MA' },
  { id: 'h-ldn', name: 'London', location: 'London, UK' },
];

export const people: Person[] = [
  { id: 'p-1', name: 'Jesse', householdId: 'h-oak' },
  { id: 'p-2', name: 'Siwen', householdId: 'h-oak' },
  { id: 'p-3', name: 'Marta', householdId: 'h-chi' },
  { id: 'p-4', name: 'Alan', householdId: 'h-chi' },
  { id: 'p-5', name: 'Nina', householdId: 'h-bos' },
  { id: 'p-6', name: 'Ravi', householdId: 'h-bos' },
  { id: 'p-7', name: 'Priya', householdId: 'h-ldn' },
  { id: 'p-8', name: 'Tom', householdId: 'h-ldn' },
];

export const services: Service[] = [
  { id: 's-netflix', name: 'Netflix', monthlyPrice: 17.99, sharingPolicy: 'household-only', extraMemberPrice: 7.99 },
  { id: 's-max', name: 'Max', monthlyPrice: 16.99, sharingPolicy: 'household-only' },
  { id: 's-disney', name: 'Disney+', monthlyPrice: 9.99, sharingPolicy: 'household-only', extraMemberPrice: 6.99 },
  { id: 's-hulu', name: 'Hulu', monthlyPrice: 9.99, sharingPolicy: 'household-only' },
  { id: 's-appletv', name: 'Apple TV+', monthlyPrice: 9.99, sharingPolicy: 'household-only' },
  { id: 's-paramount', name: 'Paramount+', monthlyPrice: 7.99, sharingPolicy: 'household-only' },
  { id: 's-peacock', name: 'Peacock', monthlyPrice: 7.99, sharingPolicy: 'household-only' },
  { id: 's-prime', name: 'Prime Video', monthlyPrice: 8.99, sharingPolicy: 'two-adults' },
];

export const subscriptions: Subscription[] = [
  { id: 'sub-1', serviceId: 's-netflix', householdId: 'h-oak', payerId: 'p-1', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-14' },
  { id: 'sub-2', serviceId: 's-max', householdId: 'h-oak', payerId: 'p-2', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-02' },
  { id: 'sub-3', serviceId: 's-appletv', householdId: 'h-oak', payerId: 'p-1', monthlyCost: 8.32, billingCycle: 'annual', renewsOn: '2027-01-19' },

  { id: 'sub-4', serviceId: 's-netflix', householdId: 'h-chi', payerId: 'p-3', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-21' },
  { id: 'sub-5', serviceId: 's-max', householdId: 'h-chi', payerId: 'p-4', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-09' },
  { id: 'sub-6', serviceId: 's-hulu', householdId: 'h-chi', payerId: 'p-3', monthlyCost: 9.99, billingCycle: 'monthly', renewsOn: '2026-08-28' },

  { id: 'sub-7', serviceId: 's-netflix', householdId: 'h-bos', payerId: 'p-5', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-05' },
  { id: 'sub-8', serviceId: 's-disney', householdId: 'h-bos', payerId: 'p-6', monthlyCost: 9.99, billingCycle: 'monthly', renewsOn: '2026-08-17' },
  { id: 'sub-9', serviceId: 's-paramount', householdId: 'h-bos', payerId: 'p-5', monthlyCost: 6.66, billingCycle: 'annual', renewsOn: '2026-11-30' },

  { id: 'sub-10', serviceId: 's-netflix', householdId: 'h-ldn', payerId: 'p-7', monthlyCost: 17.99, billingCycle: 'monthly', renewsOn: '2026-08-11' },
  { id: 'sub-11', serviceId: 's-prime', householdId: 'h-ldn', payerId: 'p-8', monthlyCost: 8.99, billingCycle: 'monthly', renewsOn: '2026-08-23' },
  { id: 'sub-12', serviceId: 's-max', householdId: 'h-ldn', payerId: 'p-7', monthlyCost: 16.99, billingCycle: 'monthly', renewsOn: '2026-08-26' },
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
];

/**
 * Stand-in for a real availability feed. Note the deliberate gaps: some rent
 * offers carry no price, which is precisely what TMDB returns. The UI has to
 * survive that, so the mock forces the case.
 */
export const mockOffers: Record<string, Offer[]> = {
  't-1': [{ serviceId: 's-appletv', kind: 'flatrate' }],
  't-2': [
    { serviceId: 's-max', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'buy', price: 24.99 },
  ],
  't-3': [
    { serviceId: 's-hulu', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'rent', price: 3.99 },
  ],
  't-4': [
    { serviceId: 's-max', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'rent', price: 4.99 },
    { serviceId: 's-appletv', kind: 'buy', price: 14.99 },
  ],
  't-5': [
    { serviceId: 's-hulu', kind: 'flatrate' },
    { serviceId: 's-disney', kind: 'flatrate' },
  ],
  't-6': [{ serviceId: 's-disney', kind: 'flatrate' }],
  't-7': [
    { serviceId: 's-hulu', kind: 'flatrate' },
    { serviceId: 's-prime', kind: 'rent' }, // price unknown, as TMDB would leave it
  ],
  't-8': [{ serviceId: 's-appletv', kind: 'flatrate' }],
  't-9': [{ serviceId: 's-netflix', kind: 'flatrate' }],
};
