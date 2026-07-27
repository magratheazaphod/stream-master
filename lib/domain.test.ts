import { describe, expect, it } from 'vitest';
import {
  MockAvailabilityProvider,
  confidenceOf,
  reconcile,
  type MockTable,
} from './availability';
import {
  currentMonthlySpend,
  duplicates,
  loadAvailability,
  rankedWatchlist,
  resolveTitle,
  rotationPlan,
  upcomingRenewals,
  type AvailabilitySnapshot,
  type Catalog,
} from './domain';
import type { AvailabilityRequest, TitleAvailability } from './types';

/** A deliberately small fixture, so failures point at one rule. */
function fixture(offers: MockTable): Catalog {
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
    country: 'US',
  };
}

/** Catalog plus its resolved availability, which is what every rule now takes. */
async function resolved(offers: MockTable): Promise<[Catalog, AvailabilitySnapshot]> {
  const c = fixture(offers);
  return [c, await loadAvailability(c)];
}

const only = (c: Catalog, snap: AvailabilitySnapshot) =>
  resolveTitle(c, snap, c.titles[0]);

/** The same fixture with the second household's row paused. */
function withPausedSecond(offers: MockTable = {}): Catalog {
  const c = fixture(offers);
  return {
    ...c,
    subscriptions: [
      c.subscriptions[0],
      { ...c.subscriptions[1], status: 'paused', pausedOn: '2026-06-01', resumeBy: '2026-09-01' },
    ],
  };
}

describe('spend', () => {
  it('sums what every household pays per month', () => {
    expect(currentMonthlySpend(fixture({}))).toBe(20);
  });

  it('leaves a paused subscription out of the bill', () => {
    expect(currentMonthlySpend(withPausedSecond())).toBe(10);
  });

  it('treats a row with no status as active, so old data keeps its meaning', () => {
    const c = fixture({});
    expect(c.subscriptions.every((s) => s.status === undefined)).toBe(true);
    expect(currentMonthlySpend(c)).toBe(20);
  });
});

describe('duplicates', () => {
  it('flags a service two households pay for, and prices the redundant copy', () => {
    const d = duplicates(fixture({}));
    expect(d).toHaveLength(1);
    expect(d[0].service.id).toBe('sA');
    expect(d[0].redundantMonthly).toBe(10);
  });

  it('stops calling it a duplicate once one household has paused', () => {
    expect(duplicates(withPausedSecond())).toHaveLength(0);
  });
});

describe('pausing', () => {
  it('does not count a paused service as coverage for that household', async () => {
    const c = withPausedSecond({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    const verdict = resolveTitle(c, await loadAvailability(c), c.titles[0]);
    expect(verdict.coveredFor.map((p) => p.id)).toEqual(['p1']);
    expect(verdict.uncoveredFor.map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps a paused row out of the renewal queue', () => {
    const from = new Date(2026, 7, 1);
    const active = upcomingRenewals(fixture({}), from, 60).map((r) => r.subscription.id);
    const paused = upcomingRenewals(withPausedSecond(), from, 60).map((r) => r.subscription.id);
    expect(active).toContain('x2');
    expect(paused).not.toContain('x2');
  });
});

describe('coverage', () => {
  it('counts a person covered only when their own household holds the service', async () => {
    const [c, snap] = await resolved({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    const v = only(c, snap);
    expect(v.status).toBe('available');
    expect(v.coveredFor.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(v.uncoveredFor).toHaveLength(0);
  });

  it('does not let one household cover another', async () => {
    const [c, snap] = await resolved({ t1: [{ serviceId: 'sB', kind: 'flatrate' }] });
    const v = only(c, snap);
    expect(v.coveredFor).toHaveLength(0);
    expect(v.uncoveredFor.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('unknown is not unavailable', () => {
  it('puts everyone in unknownFor when the source has no record of the title', async () => {
    const [c, snap] = await resolved({});
    const v = only(c, snap);
    expect(v.status).toBe('unknown');
    expect(v.confidence).toBe('unknown');
    expect(v.unknownFor.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(v.coveredFor).toHaveLength(0);
    expect(v.uncoveredFor).toHaveLength(0);
  });

  it('does not schedule a title the source could not confirm, and says so', async () => {
    const [c, snap] = await resolved({});
    const plan = rotationPlan(c, snap);
    expect(plan.cells).toHaveLength(0);
    expect(plan.unplaced).toEqual([{ title: c.titles[0], reason: 'unknown-availability' }]);
  });

  it('separates a confirmed empty answer from an unconfirmed one', async () => {
    const [c, snap] = await resolved({ t1: { series: [] } });
    const v = only(c, snap);
    expect(v.status).toBe('unavailable');
    expect(v.uncoveredFor.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(v.unknownFor).toHaveLength(0);
    expect(rotationPlan(c, snap).unplaced[0].reason).toBe('no-flatrate-offer');
  });

  it('reports unknown when a provider throws rather than calling it unavailable', async () => {
    const c = fixture({});
    c.availability = {
      name: 'broken',
      availabilityFor(): Promise<TitleAvailability> {
        throw new Error('network down');
      },
    };
    const snap = await loadAvailability(c);
    const v = only(c, snap);
    expect(v.status).toBe('unknown');
    expect(v.unknownFor).toHaveLength(2);
  });
});

describe('cheapest way in', () => {
  it('prefers the cheapest priced offer regardless of kind', async () => {
    const [c, snap] = await resolved({
      t1: [
        { serviceId: 'sB', kind: 'flatrate' },
        { serviceId: 'sB', kind: 'rent', price: 4.99 },
      ],
    });
    const v = only(c, snap);
    expect(v.cheapest?.kind).toBe('rent');
    expect(v.cheapest?.cost).toBe(4.99);
  });

  it('never picks an offer with no price, and still lists it', async () => {
    const [c, snap] = await resolved({
      t1: [
        { serviceId: 'sB', kind: 'rent' },
        { serviceId: 'sB', kind: 'flatrate' },
      ],
    });
    const v = only(c, snap);
    expect(v.cheapest?.kind).toBe('flatrate');
    expect(v.options).toHaveLength(2);
  });
});

describe('seasons', () => {
  it('reports which seasons a service actually carries', async () => {
    const [c, snap] = await resolved({
      t1: {
        series: [{ serviceId: 'sA', kind: 'flatrate' }],
        seasons: {
          1: [{ serviceId: 'sA', kind: 'flatrate' }],
          2: [{ serviceId: 'sA', kind: 'flatrate' }],
        },
      },
    });
    const v = only(c, snap);
    expect(v.options[0].seasons).toEqual([1, 2]);
    expect(v.options[0].partial).toBe(false);
    expect(v.discrepancies).toHaveLength(0);
  });

  it('flags a service the union names that carries only some seasons', async () => {
    const [c, snap] = await resolved({
      t1: {
        series: [
          { serviceId: 'sA', kind: 'flatrate' },
          { serviceId: 'sB', kind: 'flatrate' },
        ],
        seasons: {
          1: [
            { serviceId: 'sA', kind: 'flatrate' },
            { serviceId: 'sB', kind: 'flatrate' },
          ],
          2: [{ serviceId: 'sB', kind: 'flatrate' }],
        },
      },
    });
    const v = only(c, snap);
    const d = v.discrepancies.find((x) => x.serviceId === 'sA')!;
    expect(d.kind).toBe('partial-seasons');
    expect(d.carries).toEqual([1]);
    expect(d.missing).toEqual([2]);
  });

  it('schedules the service that carries every season over the cheaper partial one', async () => {
    const [c, snap] = await resolved({
      t1: {
        // sA is half the price of sB and carries half the show.
        series: [
          { serviceId: 'sA', kind: 'flatrate' },
          { serviceId: 'sB', kind: 'flatrate' },
        ],
        seasons: {
          1: [
            { serviceId: 'sA', kind: 'flatrate' },
            { serviceId: 'sB', kind: 'flatrate' },
          ],
          2: [{ serviceId: 'sB', kind: 'flatrate' }],
        },
      },
    });
    const plan = rotationPlan(c, snap);
    expect(plan.cells.map((x) => x.serviceId)).toEqual(['sB']);
    expect(plan.partial).toHaveLength(0);
  });

  it('names the stranding when every option runs out mid-series', async () => {
    const [c, snap] = await resolved({
      t1: {
        series: [{ serviceId: 'sA', kind: 'flatrate' }],
        seasons: { 1: [{ serviceId: 'sA', kind: 'flatrate' }], 2: [] },
      },
    });
    const plan = rotationPlan(c, snap);
    expect(plan.cells.map((x) => x.serviceId)).toEqual(['sA']);
    expect(plan.partial).toHaveLength(1);
    expect(plan.partial[0].missing).toEqual([2]);
  });

  it('flags a union entry that no season backs up', async () => {
    const [c, snap] = await resolved({
      t1: {
        series: [
          { serviceId: 'sA', kind: 'flatrate' },
          { serviceId: 'sB', kind: 'flatrate' },
        ],
        seasons: { 1: [{ serviceId: 'sB', kind: 'flatrate' }] },
      },
    });
    const v = only(c, snap);
    expect(v.discrepancies.find((d) => d.serviceId === 'sA')?.kind).toBe('series-only');
  });

  it('treats an unconfirmed season as a gap, not as a disagreement', async () => {
    const [c, snap] = await resolved({
      t1: {
        series: [{ serviceId: 'sA', kind: 'flatrate' }],
        seasons: { 1: [{ serviceId: 'sA', kind: 'flatrate' }], 2: null },
      },
    });
    const v = only(c, snap);
    expect(v.unresolvedSeasons).toEqual([2]);
    expect(v.discrepancies).toHaveLength(0);
  });

  it('asks for no season detail on a film and reports none', async () => {
    const c = fixture({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    c.titles[0].kind = 'film';
    const snap = await loadAvailability(c);
    expect(reconcile(snap.get('t1')!).seasonDetail).toBe('not-applicable');
    expect(only(c, snap).options[0].seasons).toBeUndefined();
  });
});

describe('freshness', () => {
  const request: AvailabilityRequest = {
    titleId: 't1',
    kind: 'series',
    country: 'US',
    detail: 'with-seasons',
  };

  it('calls a recent answer confirmed and an old one stale', async () => {
    const p = new MockAvailabilityProvider({
      t1: { series: [{ serviceId: 'sA', kind: 'flatrate' }], observedAt: '2026-07-01T00:00:00Z' },
    });
    const a = await p.availabilityFor(request);
    expect(confidenceOf(a, new Date('2026-07-03T00:00:00Z'))).toBe('confirmed');
    expect(confidenceOf(a, new Date('2026-08-01T00:00:00Z'))).toBe('stale');
  });

  it('never calls an unconfirmed answer stale, because staleness implies an answer', async () => {
    const p = new MockAvailabilityProvider({});
    const a = await p.availabilityFor(request);
    expect(confidenceOf(a, new Date('2030-01-01T00:00:00Z'))).toBe('unknown');
  });
});

describe('ranking', () => {
  it('sorts by how many people want a title', async () => {
    const c = fixture({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    c.titles.push({ id: 't2', name: 'Other', year: 2026, kind: 'film', plannedMonth: 0 });
    c.interests.push({ titleId: 't2', personId: 'p1' });
    const snap = await loadAvailability(c);
    expect(rankedWatchlist(c, snap).map((v) => v.title.id)).toEqual(['t1', 't2']);
  });
});

describe('rotation plan', () => {
  it('charges a household only for the months it needs a service', async () => {
    const [c, snap] = await resolved({ t1: [{ serviceId: 'sA', kind: 'flatrate' }] });
    const plan = rotationPlan(c, snap);
    // Two households want one title in one month: 2 household-months at $10.
    expect(plan.plannedAnnual).toBe(20);
    expect(plan.currentAnnual).toBe(240);
    expect(plan.savedAnnual).toBe(220);
  });

  it('names services nobody on the watchlist justifies', async () => {
    const [c, snap] = await resolved({ t1: [{ serviceId: 'sB', kind: 'flatrate' }] });
    const plan = rotationPlan(c, snap);
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
