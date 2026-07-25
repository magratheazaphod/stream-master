import { describe, expect, it } from 'vitest';
import { MockAvailabilityProvider } from './availability';
import {
  currentMonthlySpend,
  duplicates,
  rankedWatchlist,
  resolveTitle,
  rotationPlan,
  upcomingRenewals,
  type Catalog,
} from './domain';
import type { Offer } from './types';

/** A deliberately small fixture, so failures point at one rule. */
function fixture(offers: Record<string, Offer[]>): Catalog {
  return {
    households: [
      { id: 'h1', name: 'One', location: 'A' },
      { id: 'h2', name: 'Two', location: 'B' },
    ],
    people: [
      { id: 'p1', name: 'Ann', householdId: 'h1' },
      { id: 'p2', name: 'Bo', householdId: 'h2' },
    ],
    services: [
      { id: 'sA', name: 'A', monthlyPrice: 10, sharingPolicy: 'household-only' },
      { id: 'sB', name: 'B', monthlyPrice: 20, sharingPolicy: 'household-only' },
    ],
    subscriptions: [
      { id: 'x1', serviceId: 'sA', householdId: 'h1', payerId: 'p1', monthlyCost: 10, billingCycle: 'monthly', renewsOn: '2026-08-10' },
      { id: 'x2', serviceId: 'sA', householdId: 'h2', payerId: 'p2', monthlyCost: 10, billingCycle: 'monthly', renewsOn: '2026-09-20' },
    ],
    titles: [{ id: 't1', name: 'Show', year: 2026, kind: 'series', plannedMonth: 1 }],
    interests: [
      { titleId: 't1', personId: 'p1' },
      { titleId: 't1', personId: 'p2' },
    ],
    availability: new MockAvailabilityProvider(offers),
  };
}

describe('spend', () => {
  it('sums what every household pays per month', () => {
    expect(currentMonthlySpend(fixture({}))).toBe(20);
  });
});

describe('duplicates', () => {
  it('flags a service two households pay for, and prices the redundant copy', () => {
    const d = duplicates(fixture({}));
    expect(d).toHaveLength(1);
    expect(d[0].service.id).toBe('sA');
    expect(d[0].redundantMonthly).toBe(10);
  });
});

describe('coverage', () => {
  it('counts a person covered only when their own household holds the service', () => {
    const c = fixture({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    const v = resolveTitle(c, c.titles[0]);
    expect(v.coveredFor.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(v.uncoveredFor).toHaveLength(0);
  });

  it('does not let one household cover another', () => {
    const c = fixture({ t1: [{ serviceId: 'sB', kind: 'flatrate' }] });
    const v = resolveTitle(c, c.titles[0]);
    expect(v.coveredFor).toHaveLength(0);
    expect(v.uncoveredFor.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('cheapest way in', () => {
  it('prefers the cheapest priced offer regardless of kind', () => {
    const c = fixture({
      t1: [
        { serviceId: 'sB', kind: 'flatrate' },
        { serviceId: 'sB', kind: 'rent', price: 4.99 },
      ],
    });
    const v = resolveTitle(c, c.titles[0]);
    expect(v.cheapest?.kind).toBe('rent');
    expect(v.cheapest?.cost).toBe(4.99);
  });

  it('never picks an offer with no price, and still lists it', () => {
    const c = fixture({
      t1: [
        { serviceId: 'sB', kind: 'rent' },
        { serviceId: 'sB', kind: 'flatrate' },
      ],
    });
    const v = resolveTitle(c, c.titles[0]);
    expect(v.cheapest?.kind).toBe('flatrate');
    expect(v.options).toHaveLength(2);
  });
});

describe('ranking', () => {
  it('sorts by how many people want a title', () => {
    const c = fixture({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    c.titles.push({ id: 't2', name: 'Other', year: 2026, kind: 'film', plannedMonth: 0 });
    c.interests.push({ titleId: 't2', personId: 'p1' });
    expect(rankedWatchlist(c).map((v) => v.title.id)).toEqual(['t1', 't2']);
  });
});

describe('rotation plan', () => {
  it('charges a household only for the months it needs a service', () => {
    const c = fixture({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    const plan = rotationPlan(c);
    // Two households want one title in one month: 2 household-months at $10.
    expect(plan.plannedAnnual).toBe(20);
    expect(plan.currentAnnual).toBe(240);
    expect(plan.savedAnnual).toBe(220);
  });

  it('names services nobody on the watchlist justifies', () => {
    const c = fixture({ t1: [{ serviceId: 'sB', kind: 'flatrate' }] });
    const plan = rotationPlan(c);
    expect(plan.unjustified.map((u) => u.service.id)).toEqual(['sA']);
    expect(plan.unjustified[0].annualCost).toBe(240);
  });
});

describe('renewals', () => {
  it('returns only renewals inside the window, soonest first', () => {
    const r = upcomingRenewals(fixture({}), new Date('2026-08-01'), 30);
    expect(r).toHaveLength(1);
    expect(r[0].subscription.id).toBe('x1');
  });
});
