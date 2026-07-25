/**
 * All product logic. Pure functions over plain data, so the rules stay testable
 * and survive the move from fixtures to a real database.
 */

import type {
  AvailabilityProvider,
  Household,
  HouseholdId,
  Interest,
  Offer,
  Person,
  Service,
  ServiceId,
  Subscription,
  Title,
} from './types';

export const HORIZON_MONTHS = 12;

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Parse a plain `YYYY-MM-DD` as a local date. `new Date('2026-08-02')` is read as
 * UTC midnight, which renders as the day before anywhere west of Greenwich.
 */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export interface Catalog {
  households: Household[];
  people: Person[];
  services: Service[];
  subscriptions: Subscription[];
  titles: Title[];
  interests: Interest[];
  availability: AvailabilityProvider;
}

const serviceById = (c: Catalog, id: ServiceId) =>
  c.services.find((s) => s.id === id)!;

const householdById = (c: Catalog, id: HouseholdId) =>
  c.households.find((h) => h.id === id)!;

/** What the family pays right now, holding everything continuously. */
export function currentMonthlySpend(c: Catalog): number {
  return money(c.subscriptions.reduce((sum, s) => sum + s.monthlyCost, 0));
}

export interface Duplicate {
  service: Service;
  households: Household[];
  /** What the redundant copies cost per month, beyond the first. */
  redundantMonthly: number;
}

/**
 * Two households paying for the same service is not automatically waste - they
 * cannot share it. It is waste only when their demand does not overlap in time,
 * which the rotation plan settles. This function surfaces the candidates.
 */
export function duplicates(c: Catalog): Duplicate[] {
  const byService = new Map<ServiceId, Subscription[]>();
  for (const sub of c.subscriptions) {
    byService.set(sub.serviceId, [...(byService.get(sub.serviceId) ?? []), sub]);
  }

  return [...byService.entries()]
    .filter(([, subs]) => subs.length > 1)
    .map(([serviceId, subs]) => ({
      service: serviceById(c, serviceId),
      households: subs.map((s) => householdById(c, s.householdId)),
      redundantMonthly: money(
        subs.slice(1).reduce((sum, s) => sum + s.monthlyCost, 0),
      ),
    }))
    .sort((a, b) => b.redundantMonthly - a.redundantMonthly);
}

export interface AcquisitionOption {
  service: Service;
  kind: Offer['kind'];
  /** Undefined when the availability source supplies no price. */
  cost?: number;
}

export interface TitleVerdict {
  title: Title;
  wantedBy: Person[];
  interestCount: number;
  /** Interested people whose own household already carries a streaming offer. */
  coveredFor: Person[];
  /** The service covering them, where one exists. */
  coveringServices: Service[];
  /** Interested people whose household would have to acquire it. */
  uncoveredFor: Person[];
  /** Ranked cheapest paths for an uncovered household. Priced options first. */
  options: AcquisitionOption[];
  cheapest?: AcquisitionOption;
}

/**
 * Ranks the shared list by how many family members want each title, then
 * resolves each one against what the family already holds.
 */
export function rankedWatchlist(c: Catalog): TitleVerdict[] {
  return c.titles
    .map((title) => resolveTitle(c, title))
    .sort(
      (a, b) =>
        b.interestCount - a.interestCount ||
        a.title.plannedMonth - b.title.plannedMonth,
    );
}

export function resolveTitle(c: Catalog, title: Title): TitleVerdict {
  const wantedBy = c.interests
    .filter((i) => i.titleId === title.id)
    .map((i) => c.people.find((p) => p.id === i.personId)!)
    .filter(Boolean);

  const offers = c.availability.offersFor(title.id);
  const flatrate = offers.filter((o) => o.kind === 'flatrate');

  const coveredFor: Person[] = [];
  const uncoveredFor: Person[] = [];
  const coveringIds = new Set<ServiceId>();

  for (const person of wantedBy) {
    const held = flatrate.find((o) =>
      c.subscriptions.some(
        (s) => s.householdId === person.householdId && s.serviceId === o.serviceId,
      ),
    );
    if (held) {
      coveredFor.push(person);
      coveringIds.add(held.serviceId);
    } else {
      uncoveredFor.push(person);
    }
  }

  const options: AcquisitionOption[] = offers
    .map((o) => ({
      service: serviceById(c, o.serviceId),
      kind: o.kind,
      cost: o.kind === 'flatrate' ? serviceById(c, o.serviceId).monthlyPrice : o.price,
    }))
    .sort((a, b) => {
      if (a.cost === undefined) return 1;
      if (b.cost === undefined) return -1;
      return a.cost - b.cost;
    });

  return {
    title,
    wantedBy,
    interestCount: wantedBy.length,
    coveredFor,
    coveringServices: [...coveringIds].map((id) => serviceById(c, id)),
    uncoveredFor,
    options,
    cheapest: options.find((o) => o.cost !== undefined),
  };
}

export interface PlanCell {
  serviceId: ServiceId;
  month: number;
  /** Households that need this service that month, and why. */
  households: HouseholdId[];
  titles: string[];
}

export interface RotationPlan {
  /** services x months, sparse - only months with real demand appear. */
  cells: PlanCell[];
  services: Service[];
  currentAnnual: number;
  plannedAnnual: number;
  savedAnnual: number;
  /** Services held today that no watchlist title justifies. */
  unjustified: { service: Service; households: Household[]; annualCost: number }[];
}

/**
 * The calendar. For every title someone wants, work out which service that
 * person's household must hold, and in which month. A household pays for a
 * service only in the months it needs it.
 */
export function rotationPlan(c: Catalog): RotationPlan {
  const cellMap = new Map<string, PlanCell>();
  const justified = new Set<string>(); // `${householdId}:${serviceId}`

  for (const title of c.titles) {
    const verdict = resolveTitle(c, title);
    const wanted = verdict.wantedBy;
    if (wanted.length === 0) continue;

    const flatrateOptions = verdict.options.filter((o) => o.kind === 'flatrate');
    if (flatrateOptions.length === 0) continue;

    for (const person of wanted) {
      // Prefer a service the household already holds, else the cheapest one.
      const held = flatrateOptions.find((o) =>
        c.subscriptions.some(
          (s) => s.householdId === person.householdId && s.serviceId === o.service.id,
        ),
      );
      const chosen = held ?? flatrateOptions[0];
      const key = `${chosen.service.id}:${title.plannedMonth}`;
      const cell = cellMap.get(key) ?? {
        serviceId: chosen.service.id,
        month: title.plannedMonth,
        households: [],
        titles: [],
      };
      if (!cell.households.includes(person.householdId)) {
        cell.households.push(person.householdId);
      }
      if (!cell.titles.includes(title.name)) cell.titles.push(title.name);
      cellMap.set(key, cell);
      justified.add(`${person.householdId}:${chosen.service.id}`);
    }
  }

  const cells = [...cellMap.values()];

  const plannedAnnual = money(
    cells.reduce((sum, cell) => {
      const price = serviceById(c, cell.serviceId).monthlyPrice;
      return sum + price * cell.households.length;
    }, 0),
  );

  const currentAnnual = money(currentMonthlySpend(c) * 12);

  const unjustifiedMap = new Map<ServiceId, Household[]>();
  for (const sub of c.subscriptions) {
    if (justified.has(`${sub.householdId}:${sub.serviceId}`)) continue;
    unjustifiedMap.set(sub.serviceId, [
      ...(unjustifiedMap.get(sub.serviceId) ?? []),
      householdById(c, sub.householdId),
    ]);
  }

  const unjustified = [...unjustifiedMap.entries()]
    .map(([serviceId, hs]) => ({
      service: serviceById(c, serviceId),
      households: hs,
      annualCost: money(
        c.subscriptions
          .filter(
            (s) =>
              s.serviceId === serviceId &&
              hs.some((h) => h.id === s.householdId),
          )
          .reduce((sum, s) => sum + s.monthlyCost * 12, 0),
      ),
    }))
    .sort((a, b) => b.annualCost - a.annualCost);

  const usedServiceIds = new Set(cells.map((c2) => c2.serviceId));
  const servicesInPlan = c.services.filter((s) => usedServiceIds.has(s.id));

  return {
    cells,
    services: servicesInPlan,
    currentAnnual,
    plannedAnnual,
    savedAnnual: money(currentAnnual - plannedAnnual),
    unjustified,
  };
}

/** Renewal dates inside the next `days` days. Forgetting to cancel is the leak. */
export function upcomingRenewals(c: Catalog, from: Date, days = 30) {
  const limit = new Date(from.getTime() + days * 86_400_000);
  return c.subscriptions
    .map((s) => ({ sub: s, on: localDate(s.renewsOn) }))
    .filter(({ on }) => on >= from && on <= limit)
    .sort((a, b) => a.on.getTime() - b.on.getTime())
    .map(({ sub, on }) => ({
      subscription: sub,
      service: serviceById(c, sub.serviceId),
      household: householdById(c, sub.householdId),
      on,
    }));
}
