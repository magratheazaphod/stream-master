/**
 * All product logic. Pure functions over plain data, so the rules stay testable
 * and survive the move from fixtures to a real database.
 *
 * Availability is the one fact the app cannot compute, so `loadAvailability` is
 * the single async boundary in this file. It resolves once, and every rule below
 * reads the resulting snapshot synchronously. Threading a promise through every
 * rule instead would buy nothing and cost the purity the tests depend on.
 */

import { confidenceOf, offersOf, reconcile, unresolvedAvailability } from './availability';
import type {
  AvailabilityProvider,
  AvailabilityRequest,
  Confidence,
  CountryCode,
  Discrepancy,
  Household,
  HouseholdId,
  Interest,
  Offer,
  PauseTerms,
  Person,
  SeasonNumber,
  Service,
  ServiceId,
  Subscription,
  Title,
  TitleAvailability,
  TitleId,
} from './types';

export const HORIZON_MONTHS = 12;

/** Month labels for the planning horizon. Calendar, not data. */
export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

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
  /**
   * Where availability gets resolved. One country today. Households already carry
   * a location, so per-household resolution is the next step, and the point of
   * naming the country here is that nothing downstream may assume US.
   */
  country: CountryCode;
}

/** Availability for every title on the list, fetched once and read many times. */
export type AvailabilitySnapshot = ReadonlyMap<TitleId, TitleAvailability>;

/**
 * The async boundary. Resolves every title on the watchlist in parallel.
 *
 * Season detail costs a request per season, so it is asked for only where it
 * changes an answer: series. Films get the whole-title answer and nothing more.
 */
export async function loadAvailability(c: Catalog): Promise<AvailabilitySnapshot> {
  const requests: AvailabilityRequest[] = c.titles.map((t) => ({
    titleId: t.id,
    kind: t.kind,
    country: c.country,
    detail: t.kind === 'series' ? 'with-seasons' : 'series-only',
  }));

  const answers = await Promise.all(
    requests.map(async (r) => {
      try {
        return await c.availability.availabilityFor(r);
      } catch {
        // A provider is not supposed to throw. If one does, the answer is still
        // unknown - it is never an absence of offers.
        return unresolvedAvailability(
          r,
          c.availability.name,
          new Date().toISOString(),
          'source-error',
        );
      }
    }),
  );

  return new Map(answers.map((a) => [a.titleId, a]));
}

const serviceById = (c: Catalog, id: ServiceId) =>
  c.services.find((s) => s.id === id)!;

const householdById = (c: Catalog, id: HouseholdId) =>
  c.households.find((h) => h.id === id)!;

/**
 * A row with no status predates pausing and is active. Every reader of spend,
 * duplication or renewals goes through this, because counting a paused row is
 * the one arithmetic error that would make the whole product lie about savings.
 */
export const isActive = (s: Subscription) => (s.status ?? 'active') === 'active';

export const isPaused = (s: Subscription) => s.status === 'paused';

/** The rows currently billing. Paused rows stay in the catalog and cost nothing. */
export const activeSubscriptions = (c: Catalog) => c.subscriptions.filter(isActive);

/** What the family pays right now. Paused rows are not being billed. */
export function currentMonthlySpend(c: Catalog): number {
  return money(activeSubscriptions(c).reduce((sum, s) => sum + s.monthlyCost, 0));
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
 *
 * Paused rows are excluded. A household that already stopped paying is not part
 * of a duplicate, and counting it would charge the family twice for a saving it
 * has already banked.
 */
export function duplicates(c: Catalog): Duplicate[] {
  const byService = new Map<ServiceId, Subscription[]>();
  for (const sub of activeSubscriptions(c)) {
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
  /**
   * Seasons this service carries, where season detail resolved. Undefined for
   * films and for series the source could not break down. A short list against a
   * long series is the mid-series split, and it is why the union alone will not do.
   */
  seasons?: SeasonNumber[];
  /** The service carries some resolved seasons but not all. Buying it strands someone. */
  partial: boolean;
}

/**
 * What the source could tell us about a title. `unknown` is a state the caller
 * has to render, not an absence to skip past.
 */
export type TitleStatus = 'available' | 'unavailable' | 'unknown';

export interface TitleVerdict {
  title: Title;
  wantedBy: Person[];
  interestCount: number;
  /** Whether the source confirmed anything at all. */
  status: TitleStatus;
  confidence: Confidence;
  /** Interested people whose own household already carries a streaming offer. */
  coveredFor: Person[];
  /** The service covering them, where one exists. */
  coveringServices: Service[];
  /** Interested people whose household would have to acquire it. */
  uncoveredFor: Person[];
  /**
   * Interested people we cannot answer for, because the source could not confirm
   * the title. Held apart from `uncoveredFor` so nobody gets told to buy a
   * subscription on the strength of a gap in the data.
   */
  unknownFor: Person[];
  /** Ranked cheapest paths for an uncovered household. Priced options first. */
  options: AcquisitionOption[];
  cheapest?: AcquisitionOption;
  /** Where the series union and the season detail disagree. Empty for films. */
  discrepancies: Discrepancy[];
  /** Seasons the source could not confirm. Non-empty means the plan has a hole. */
  unresolvedSeasons: SeasonNumber[];
}

/**
 * Ranks the shared list by how many family members want each title, then
 * resolves each one against what the family already holds.
 */
export function rankedWatchlist(
  c: Catalog,
  snapshot: AvailabilitySnapshot,
  now = new Date(),
): TitleVerdict[] {
  return c.titles
    .map((title) => resolveTitle(c, snapshot, title, now))
    .sort(
      (a, b) =>
        b.interestCount - a.interestCount ||
        a.title.plannedMonth - b.title.plannedMonth,
    );
}

export function resolveTitle(
  c: Catalog,
  snapshot: AvailabilitySnapshot,
  title: Title,
  now = new Date(),
): TitleVerdict {
  const wantedBy = c.interests
    .filter((i) => i.titleId === title.id)
    .map((i) => c.people.find((p) => p.id === i.personId)!)
    .filter(Boolean);

  const found = snapshot.get(title.id);
  const availability =
    found ??
    unresolvedAvailability(
      { titleId: title.id, kind: title.kind, country: c.country, detail: 'series-only' },
      'none',
      now.toISOString(),
    );

  const status = availability.series.status;
  const confidence = confidenceOf(availability, now);
  const { coverage, discrepancies, unresolvedSeasons } = reconcile(availability);

  // The union, and only the union, says which services carry the title at all.
  // The season detail then qualifies each one rather than replacing it.
  const offers = offersOf(availability.series);
  const flatrate = offers.filter((o) => o.kind === 'flatrate');

  const coveredFor: Person[] = [];
  const uncoveredFor: Person[] = [];
  const unknownFor: Person[] = [];
  const coveringIds = new Set<ServiceId>();

  for (const person of wantedBy) {
    if (status === 'unknown') {
      unknownFor.push(person);
      continue;
    }
    // Paused does not mean held. A paused row buys nobody access today.
    const held = flatrate.find((o) =>
      activeSubscriptions(c).some(
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
    .map((o) => {
      const reach = o.kind === 'flatrate'
        ? coverage.find((x) => x.serviceId === o.serviceId)
        : undefined;
      return {
        service: serviceById(c, o.serviceId),
        kind: o.kind,
        cost: o.kind === 'flatrate' ? serviceById(c, o.serviceId).monthlyPrice : o.price,
        seasons: reach?.carries,
        partial: reach !== undefined && reach.missing.length > 0,
      };
    })
    .sort((a, b) => {
      if (a.cost === undefined) return 1;
      if (b.cost === undefined) return -1;
      return a.cost - b.cost;
    });

  return {
    title,
    wantedBy,
    interestCount: wantedBy.length,
    status,
    confidence,
    coveredFor,
    coveringServices: [...coveringIds].map((id) => serviceById(c, id)),
    uncoveredFor,
    unknownFor,
    options,
    cheapest: options.find((o) => o.cost !== undefined),
    discrepancies,
    unresolvedSeasons,
  };
}

export interface PlanCell {
  serviceId: ServiceId;
  month: number;
  /** Households that need this service that month, and why. */
  households: HouseholdId[];
  titles: string[];
}

/** A title the plan declined to schedule, and the honest reason why. */
export interface UnplacedTitle {
  title: Title;
  reason: 'unknown-availability' | 'no-flatrate-offer';
}

/** A title the plan did schedule, on a service that does not carry all of it. */
export interface PartialPlacement {
  title: Title;
  service: Service;
  carries: SeasonNumber[];
  missing: SeasonNumber[];
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
  /**
   * Titles the calendar could not place. A plan that drops these silently is
   * worse than one that admits the gap, so they are part of the result.
   */
  unplaced: UnplacedTitle[];
  /** Placements that will run out of seasons partway through. */
  partial: PartialPlacement[];
}

/**
 * The calendar. For every title someone wants, work out which service that
 * person's household must hold, and in which month. A household pays for a
 * service only in the months it needs it.
 */
export function rotationPlan(
  c: Catalog,
  snapshot: AvailabilitySnapshot,
  now = new Date(),
): RotationPlan {
  const cellMap = new Map<string, PlanCell>();
  const justified = new Set<string>(); // `${householdId}:${serviceId}`
  const unplaced: UnplacedTitle[] = [];
  const partial: PartialPlacement[] = [];
  const partialSeen = new Set<string>(); // `${titleId}:${serviceId}`

  for (const title of c.titles) {
    const verdict = resolveTitle(c, snapshot, title, now);
    const wanted = verdict.wantedBy;
    if (wanted.length === 0) continue;

    if (verdict.status === 'unknown') {
      unplaced.push({ title, reason: 'unknown-availability' });
      continue;
    }

    const flatrateOptions = verdict.options.filter((o) => o.kind === 'flatrate');
    if (flatrateOptions.length === 0) {
      unplaced.push({ title, reason: 'no-flatrate-offer' });
      continue;
    }

    // A service that carries every resolved season beats a cheaper one that runs
    // out partway. Saving four dollars is not worth stranding somebody in season two.
    const complete = flatrateOptions.filter((o) => !o.partial);
    const usable = complete.length > 0 ? complete : flatrateOptions;

    for (const person of wanted) {
      // Prefer a service the household already holds, else the cheapest one.
      const held = usable.find((o) =>
        activeSubscriptions(c).some(
          (s) => s.householdId === person.householdId && s.serviceId === o.service.id,
        ),
      );
      const chosen = held ?? usable[0];

      const partialKey = `${title.id}:${chosen.service.id}`;
      if (chosen.partial && !partialSeen.has(partialKey)) {
        partialSeen.add(partialKey);
        const reach = verdict.discrepancies.find(
          (d) => d.serviceId === chosen.service.id,
        );
        partial.push({
          title,
          service: chosen.service,
          carries: reach?.carries ?? [],
          missing: reach?.missing ?? [],
        });
      }

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

  // Only what the family is actually paying for can be unjustified spend.
  const unjustifiedMap = new Map<ServiceId, Household[]>();
  for (const sub of activeSubscriptions(c)) {
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
        activeSubscriptions(c)
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
    unplaced,
    partial,
  };
}

/* --------------------------------------------------------------------------
 * Pausing.
 *
 * The product's one job. Everything here answers a question somebody asks with
 * their finger over a button: what am I paying for and not using, what does
 * stopping cost me beyond the money, and what did I stop and forget to restart.
 * ----------------------------------------------------------------------- */

const MONTH_MS = 30 * 86_400_000;

const monthsBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / MONTH_MS);

export interface IdleSubscription {
  subscription: Subscription;
  service: Service;
  household: Household;
  payer: Person;
  /** Whole months since anyone reported watching. Null when nobody has said. */
  idleMonths: number | null;
  /** What the household has paid since it last watched anything. */
  spentWhileIdle: number;
}

/**
 * Active subscriptions nobody has watched in a while, dearest waste first.
 *
 * A row with no `lastUsedOn` is included and reported as null rather than as
 * idle forever. Nobody answering the question is a different fact from nobody
 * watching, and charging a household for the first would be a lie the app
 * cannot back up.
 */
export function idleSubscriptions(
  c: Catalog,
  asOf: Date,
  minMonths = 2,
): IdleSubscription[] {
  return activeSubscriptions(c)
    .map((sub) => {
      const idleMonths = sub.lastUsedOn
        ? monthsBetween(localDate(sub.lastUsedOn), asOf)
        : null;
      return {
        subscription: sub,
        service: serviceById(c, sub.serviceId),
        household: householdById(c, sub.householdId),
        payer: c.people.find((p) => p.id === sub.payerId)!,
        idleMonths,
        spentWhileIdle: money(sub.monthlyCost * (idleMonths ?? 0)),
      };
    })
    .filter((r) => r.idleMonths === null || r.idleMonths >= minMonths)
    .sort((a, b) => b.spentWhileIdle - a.spentWhileIdle);
}

export interface ResumeDue {
  subscription: Subscription;
  service: Service;
  household: Household;
  due: Date;
  /** Negative until the date arrives. Positive means somebody is missing a show. */
  daysOverdue: number;
}

/**
 * Pauses due back, soonest first. The app owns this date because a pause nobody
 * lifts is the failure that ends the family's trust faster than any overspend.
 */
export function resumesDue(c: Catalog, asOf: Date, withinDays = 30): ResumeDue[] {
  return c.subscriptions
    .filter((s) => isPaused(s) && s.resumeBy)
    .map((sub) => {
      const due = localDate(sub.resumeBy!);
      return {
        subscription: sub,
        service: serviceById(c, sub.serviceId),
        household: householdById(c, sub.householdId),
        due,
        daysOverdue: Math.floor((asOf.getTime() - due.getTime()) / 86_400_000),
      };
    })
    .filter((r) => r.daysOverdue >= -withinDays)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export type PauseReason = 'idle' | 'unwanted';

export interface PauseCandidate {
  subscription: Subscription;
  service: Service;
  household: Household;
  payer: Person;
  reason: PauseReason;
  /** Why this row is on the list, in the words the screen shows. */
  because: string;
  monthlySaving: number;
  /**
   * Absent when nobody has walked this provider's flow. The screen offers no
   * button in that case, because sending somebody to a guessed URL with their
   * card out is worse than admitting the gap.
   */
  terms?: PauseTerms;
}

/**
 * What to stop paying for this month, dearest first.
 *
 * Two ways onto the list: nobody has watched it, or nobody on the watchlist
 * wants it. A row can qualify twice and appears once, because a queue that
 * repeats itself is a queue nobody finishes.
 */
export function pauseQueue(
  c: Catalog,
  snapshot: AvailabilitySnapshot,
  asOf: Date,
): PauseCandidate[] {
  const idle = new Map(
    idleSubscriptions(c, asOf).map((r) => [r.subscription.id, r]),
  );
  const unwanted = new Set(
    rotationPlan(c, snapshot).unjustified.flatMap((u) =>
      u.households.map((h) => `${h.id}:${u.service.id}`),
    ),
  );

  return activeSubscriptions(c)
    .map((sub) => {
      const hit = idle.get(sub.id);
      const service = serviceById(c, sub.serviceId);
      const reason: PauseReason | undefined = hit
        ? 'idle'
        : unwanted.has(`${sub.householdId}:${sub.serviceId}`)
          ? 'unwanted'
          : undefined;
      if (!reason) return undefined;

      const because =
        reason === 'unwanted'
          ? 'Nobody has put a title on the watchlist that needs it'
          : hit!.idleMonths === null
            ? 'Nobody has said whether this gets watched'
            : `Nobody has watched it in ${hit!.idleMonths} months, at $${hit!.spentWhileIdle.toFixed(2)} so far`;

      const candidate: PauseCandidate = {
        subscription: sub,
        service,
        household: householdById(c, sub.householdId),
        payer: c.people.find((p) => p.id === sub.payerId)!,
        reason,
        because,
        monthlySaving: sub.monthlyCost,
      };
      if (service.pause) candidate.terms = service.pause;
      return candidate;
    })
    .filter((x): x is PauseCandidate => x !== undefined)
    // Idle outranks unwanted at any price. "Nobody watched it for five months" is
    // an observation; "nobody listed a title" is an inference from an incomplete
    // watchlist, and leading with the weaker claim is how a queue loses its reader.
    .sort(
      (a, b) =>
        Number(b.reason === 'idle') - Number(a.reason === 'idle') ||
        b.monthlySaving - a.monthlySaving,
    );
}

/**
 * Renewal dates inside the next `days` days. Forgetting to pause is the leak, so
 * this is the list the pause queue is built from. Paused rows are not renewing.
 */
export function upcomingRenewals(c: Catalog, from: Date, days = 30) {
  const limit = new Date(from.getTime() + days * 86_400_000);
  return activeSubscriptions(c)
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
