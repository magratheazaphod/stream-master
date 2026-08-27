/**
 * The private-data file: its shape, its parser and its validator.
 *
 * `data/family.json` holds the one dataset that must never reach the repository.
 * Everything here exists to make loading it loud. A file that is absent means the
 * app runs on the demo dataset. A file that is present and wrong throws, naming
 * every fault, because the alternative - falling back to demo data on a bad parse -
 * leaves the reader unable to tell which family they are looking at. Silence is
 * the failure mode worth engineering against.
 *
 * Hand-rolled rather than schema-library-backed. The shape is small, the errors
 * read better than a generic issue list, and a safety property is worth owning
 * outright rather than delegating to a dependency.
 */

import { writeFileAtomic } from './atomic-write';
import type { MockTable, MockTitleFixture } from './availability';
import type {
  BillingCycle,
  BillingStopsAt,
  CountryCode,
  Household,
  Interest,
  Offer,
  OfferKind,
  PauseCost,
  PauseMethod,
  PauseTerms,
  Person,
  Service,
  SharingPolicy,
  Subscription,
  SubscriptionStatus,
  Title,
} from './types';

/** Exactly what a `data/family.json` file may contain. */
export interface FamilyFile {
  country: CountryCode;
  households: Household[];
  people: Person[];
  services: Service[];
  subscriptions: Subscription[];
  titles: Title[];
  interests: Interest[];
  /**
   * Offers keyed by title id, in the fixture table's shape. Optional: a family
   * that has not recorded any yet gets an honest `unknown` for every title
   * rather than an invented answer.
   */
  availability: MockTable;
}

/**
 * A private file the app refused. Carries every fault found, so one run fixes
 * the file instead of a dozen.
 */
export class FamilyFileError extends Error {
  constructor(
    readonly path: string,
    readonly faults: string[],
  ) {
    super(
      `Refused to load private family data from ${path}. ` +
        `The app will not fall back to demo data, because you could not then tell ` +
        `which dataset you were looking at. Fix it or remove it.\n` +
        faults.map((f) => `  - ${f}`).join('\n'),
    );
    this.name = 'FamilyFileError';
  }
}

/* -- The checker ------------------------------------------------------------ */

const SHARING_POLICIES: SharingPolicy[] = ['household-only', 'extra-member', 'two-adults'];
const BILLING_CYCLES: BillingCycle[] = ['monthly', 'annual'];
const OFFER_KINDS: OfferKind[] = ['flatrate', 'rent', 'buy'];
const PAUSE_METHODS: PauseMethod[] = ['native-pause', 'cancel-resubscribe', 'store-managed'];
const BILLING_STOPS_AT: BillingStopsAt[] = ['immediately', 'next-billing-date'];
const PAUSE_COSTS: PauseCost[] = [
  'downloads',
  'watch-list',
  'profiles',
  'grandfathered-price',
  'annual-term-forfeit',
];
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active', 'paused'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Collects faults instead of throwing on the first. A partial file usually has
 * more than one thing wrong with it and one round trip should surface them all.
 */
class Faults {
  readonly list: string[] = [];

  add(where: string, what: string) {
    this.list.push(`${where} ${what}`);
  }

  /** Guards the field checks below: returns the value only when it is present. */
  string(where: string, v: unknown): string | undefined {
    if (typeof v !== 'string' || v.trim() === '') {
      this.add(where, 'must be a non-empty string');
      return undefined;
    }
    return v;
  }

  number(where: string, v: unknown): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.add(where, 'must be a finite number');
      return undefined;
    }
    return v;
  }

  optionalNumber(where: string, v: unknown): number | undefined {
    if (v === undefined) return undefined;
    return this.number(where, v);
  }

  optionalString(where: string, v: unknown): string | undefined {
    if (v === undefined) return undefined;
    return this.string(where, v);
  }

  /** Dates carry decisions here, so a malformed one is a fault, not a shrug. */
  date(where: string, v: unknown): string | undefined {
    const s = this.string(where, v);
    if (s === undefined) return undefined;
    if (!ISO_DATE.test(s)) {
      this.add(where, 'must be an ISO date, YYYY-MM-DD');
      return undefined;
    }
    return s;
  }

  optionalDate(where: string, v: unknown): string | undefined {
    if (v === undefined) return undefined;
    return this.date(where, v);
  }

  oneOf<T extends string>(where: string, v: unknown, allowed: T[]): T | undefined {
    if (typeof v !== 'string' || !allowed.includes(v as T)) {
      this.add(where, `must be one of ${allowed.join(', ')}`);
      return undefined;
    }
    return v as T;
  }

  array(where: string, v: unknown): unknown[] | undefined {
    if (!Array.isArray(v)) {
      this.add(where, 'must be an array');
      return undefined;
    }
    return v;
  }
}

/** Rows that survived their own field checks, paired with the index they came from. */
function rows<T>(
  faults: Faults,
  where: string,
  value: unknown,
  check: (row: Record<string, unknown>, at: string) => T | undefined,
): T[] {
  const list = faults.array(where, value);
  if (!list) return [];
  const out: T[] = [];
  list.forEach((row, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(row)) {
      faults.add(at, 'must be an object');
      return;
    }
    const checked = check(row, at);
    if (checked !== undefined) out.push(checked);
  });
  return out;
}

/** Ids have to be unique or every lookup downstream silently picks the first. */
function uniqueIds(faults: Faults, where: string, items: { id: string }[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) faults.add(where, `has a duplicate id "${item.id}"`);
    seen.add(item.id);
  }
}

function offers(faults: Faults, where: string, value: unknown): Offer[] {
  return rows(faults, where, value, (row, at) => {
    const serviceId = faults.string(`${at}.serviceId`, row.serviceId);
    const kind = faults.oneOf(`${at}.kind`, row.kind, OFFER_KINDS);
    const price = faults.optionalNumber(`${at}.price`, row.price);
    if (!serviceId || !kind) return undefined;
    return price === undefined ? { serviceId, kind } : { serviceId, kind, price };
  });
}

/**
 * The hand-recorded pause facts for one service. Absent is legal and means
 * nobody has walked the flow, so the app offers no button. A present but broken
 * block is a fault, because a wrong manage URL sends somebody to the wrong page
 * with their card out.
 */
function pauseTerms(faults: Faults, where: string, value: unknown): PauseTerms | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    faults.add(where, 'must be an object with method, manageUrl, costs and verifiedOn');
    return undefined;
  }

  const method = faults.oneOf(`${where}.method`, value.method, PAUSE_METHODS);
  const manageUrl = faults.string(`${where}.manageUrl`, value.manageUrl);
  const verifiedOn = faults.date(`${where}.verifiedOn`, value.verifiedOn);
  const maxPauseMonths = faults.optionalNumber(`${where}.maxPauseMonths`, value.maxPauseMonths);
  // Optional, and absent stays absent. A default here would turn "nobody checked"
  // into a claim about when the money stops.
  const billingStopsAt =
    value.billingStopsAt === undefined
      ? undefined
      : faults.oneOf(`${where}.billingStopsAt`, value.billingStopsAt, BILLING_STOPS_AT);

  // An explicit empty list means the walkthrough found nothing lost. Omitting it
  // would make "nobody checked" and "nothing is lost" the same value.
  const costList = faults.array(`${where}.costs`, value.costs) ?? [];
  const costs: PauseCost[] = [];
  costList.forEach((cost, i) => {
    const checked = faults.oneOf(`${where}.costs[${i}]`, cost, PAUSE_COSTS);
    if (checked) costs.push(checked);
  });

  if (method === 'native-pause' && maxPauseMonths === undefined) {
    faults.add(where, 'claims a native pause but does not say for how many months');
  }
  if (method !== 'native-pause' && maxPauseMonths !== undefined) {
    faults.add(where, 'sets maxPauseMonths on a method that has no native pause');
  }

  if (!method || !manageUrl || !verifiedOn) return undefined;
  const terms: PauseTerms = { method, manageUrl, costs, verifiedOn };
  if (maxPauseMonths !== undefined) terms.maxPauseMonths = maxPauseMonths;
  if (billingStopsAt !== undefined) terms.billingStopsAt = billingStopsAt;
  return terms;
}

function availabilityTable(faults: Faults, value: unknown): MockTable {
  if (value === undefined) return {};
  if (!isObject(value)) {
    faults.add('availability', 'must be an object keyed by title id');
    return {};
  }

  const table: MockTable = {};
  for (const [titleId, entry] of Object.entries(value)) {
    const at = `availability["${titleId}"]`;
    if (Array.isArray(entry)) {
      table[titleId] = offers(faults, at, entry);
      continue;
    }
    if (!isObject(entry)) {
      faults.add(at, 'must be an array of offers or an object with series and seasons');
      continue;
    }

    const fixture: MockTitleFixture = {};
    if (entry.series !== undefined) fixture.series = offers(faults, `${at}.series`, entry.series);
    if (entry.observedAt !== undefined) {
      const observedAt = faults.string(`${at}.observedAt`, entry.observedAt);
      if (observedAt) fixture.observedAt = observedAt;
    }
    if (entry.seasons !== undefined) {
      if (!isObject(entry.seasons)) {
        faults.add(`${at}.seasons`, 'must be an object keyed by season number');
      } else {
        const seasons: Record<number, Offer[] | null> = {};
        for (const [n, seasonOffers] of Object.entries(entry.seasons)) {
          const season = Number(n);
          if (!Number.isInteger(season)) {
            faults.add(`${at}.seasons["${n}"]`, 'must be keyed by an integer season number');
            continue;
          }
          // null is meaningful here: the source answered and the answer was blank.
          seasons[season] =
            seasonOffers === null ? null : offers(faults, `${at}.seasons[${n}]`, seasonOffers);
        }
        fixture.seasons = seasons;
      }
    }
    table[titleId] = fixture;
  }
  return table;
}

/**
 * Check the parsed JSON against the shape and against itself. Referential faults
 * matter as much as missing fields: a subscription pointing at a service that is
 * not in the file crashes a page that reasonably assumes the join holds.
 */
export function checkFamilyData(value: unknown, path: string): FamilyFile {
  const faults = new Faults();
  if (!isObject(value)) {
    throw new FamilyFileError(path, ['the file must contain a JSON object at the top level']);
  }

  const country = faults.string('country', value.country) ?? 'US';

  const households = rows(faults, 'households', value.households, (row, at) => {
    const id = faults.string(`${at}.id`, row.id);
    const name = faults.string(`${at}.name`, row.name);
    const location = faults.string(`${at}.location`, row.location);
    return id && name && location ? { id, name, location } : undefined;
  });

  const people = rows(faults, 'people', value.people, (row, at) => {
    const id = faults.string(`${at}.id`, row.id);
    const name = faults.string(`${at}.name`, row.name);
    const householdId = faults.string(`${at}.householdId`, row.householdId);
    return id && name && householdId ? { id, name, householdId } : undefined;
  });

  const services = rows(faults, 'services', value.services, (row, at) => {
    const id = faults.string(`${at}.id`, row.id);
    const name = faults.string(`${at}.name`, row.name);
    const monthlyPrice = faults.number(`${at}.monthlyPrice`, row.monthlyPrice);
    const sharingPolicy = faults.oneOf(`${at}.sharingPolicy`, row.sharingPolicy, SHARING_POLICIES);
    const extraMemberPrice = faults.optionalNumber(`${at}.extraMemberPrice`, row.extraMemberPrice);
    const pause = pauseTerms(faults, `${at}.pause`, row.pause);
    if (!id || !name || monthlyPrice === undefined || !sharingPolicy) return undefined;
    const service: Service = { id, name, monthlyPrice, sharingPolicy };
    if (extraMemberPrice !== undefined) service.extraMemberPrice = extraMemberPrice;
    if (pause) service.pause = pause;
    return service;
  });

  const subscriptions = rows(faults, 'subscriptions', value.subscriptions, (row, at) => {
    const id = faults.string(`${at}.id`, row.id);
    const serviceId = faults.string(`${at}.serviceId`, row.serviceId);
    const householdId = faults.string(`${at}.householdId`, row.householdId);
    const payerId = faults.string(`${at}.payerId`, row.payerId);
    const monthlyCost = faults.number(`${at}.monthlyCost`, row.monthlyCost);
    const billingCycle = faults.oneOf(`${at}.billingCycle`, row.billingCycle, BILLING_CYCLES);
    const renewsOn = faults.date(`${at}.renewsOn`, row.renewsOn);
    const status = row.status === undefined
      ? undefined
      : faults.oneOf(`${at}.status`, row.status, SUBSCRIPTION_STATUSES);
    const pausedOn = faults.optionalDate(`${at}.pausedOn`, row.pausedOn);
    const resumeBy = faults.optionalDate(`${at}.resumeBy`, row.resumeBy);
    const lastUsedOn = faults.optionalDate(`${at}.lastUsedOn`, row.lastUsedOn);

    // A paused row that cannot say when it stopped is a row nobody can trust to
    // resume, and an active row carrying pause dates is a half-finished edit.
    if (status === 'paused' && pausedOn === undefined) {
      faults.add(at, 'is paused but does not say when, so pausedOn is required');
    }
    if (status !== 'paused' && (pausedOn !== undefined || resumeBy !== undefined)) {
      faults.add(at, 'carries pausedOn or resumeBy while not paused');
    }
    if (pausedOn && resumeBy && resumeBy < pausedOn) {
      faults.add(`${at}.resumeBy`, 'falls before pausedOn');
    }

    if (!id || !serviceId || !householdId || !payerId) return undefined;
    if (monthlyCost === undefined || !billingCycle || !renewsOn) return undefined;
    const sub: Subscription = {
      id, serviceId, householdId, payerId, monthlyCost, billingCycle, renewsOn,
    };
    if (status !== undefined) sub.status = status;
    if (pausedOn !== undefined) sub.pausedOn = pausedOn;
    if (resumeBy !== undefined) sub.resumeBy = resumeBy;
    if (lastUsedOn !== undefined) sub.lastUsedOn = lastUsedOn;
    return sub;
  });

  const titles = rows(faults, 'titles', value.titles, (row, at) => {
    const id = faults.string(`${at}.id`, row.id);
    const name = faults.string(`${at}.name`, row.name);
    const year = faults.number(`${at}.year`, row.year);
    const kind = faults.oneOf(`${at}.kind`, row.kind, ['series', 'film']);
    const plannedMonth = faults.number(`${at}.plannedMonth`, row.plannedMonth);
    if (!id || !name || year === undefined || !kind || plannedMonth === undefined) return undefined;
    return { id, name, year, kind, plannedMonth };
  });

  const interests = rows(faults, 'interests', value.interests, (row, at) => {
    const titleId = faults.string(`${at}.titleId`, row.titleId);
    const personId = faults.string(`${at}.personId`, row.personId);
    return titleId && personId ? { titleId, personId } : undefined;
  });

  const availability = availabilityTable(faults, value.availability);

  /* -- The joins have to hold ---------------------------------------------- */

  uniqueIds(faults, 'households', households);
  uniqueIds(faults, 'people', people);
  uniqueIds(faults, 'services', services);
  uniqueIds(faults, 'subscriptions', subscriptions);
  uniqueIds(faults, 'titles', titles);

  const householdIds = new Set(households.map((h) => h.id));
  const personIds = new Set(people.map((p) => p.id));
  const serviceIds = new Set(services.map((s) => s.id));
  const titleIds = new Set(titles.map((t) => t.id));

  const ref = (where: string, field: string, id: string, known: Set<string>, kind: string) => {
    if (!known.has(id)) faults.add(`${where}.${field}`, `names a ${kind} the file does not define: "${id}"`);
  };

  people.forEach((p, i) => ref(`people[${i}]`, 'householdId', p.householdId, householdIds, 'household'));
  subscriptions.forEach((s, i) => {
    ref(`subscriptions[${i}]`, 'serviceId', s.serviceId, serviceIds, 'service');
    ref(`subscriptions[${i}]`, 'householdId', s.householdId, householdIds, 'household');
    ref(`subscriptions[${i}]`, 'payerId', s.payerId, personIds, 'person');
  });
  interests.forEach((n, i) => {
    ref(`interests[${i}]`, 'titleId', n.titleId, titleIds, 'title');
    ref(`interests[${i}]`, 'personId', n.personId, personIds, 'person');
  });
  for (const [titleId, entry] of Object.entries(availability)) {
    const at = `availability["${titleId}"]`;
    if (!titleIds.has(titleId)) {
      faults.add(at, 'is keyed by a title the file does not define');
    }
    const fixture: MockTitleFixture = Array.isArray(entry) ? { series: entry } : entry;
    const all = [...(fixture.series ?? []), ...Object.values(fixture.seasons ?? {}).flatMap((o) => o ?? [])];
    for (const offer of all) {
      ref(at, 'serviceId', offer.serviceId, serviceIds, 'service');
    }
  }

  // A file with no households or no people is a partial write, not a small family.
  if (households.length === 0) faults.add('households', 'must name at least one household');
  if (people.length === 0) faults.add('people', 'must name at least one person');

  if (faults.list.length > 0) throw new FamilyFileError(path, faults.list);

  return { country, households, people, services, subscriptions, titles, interests, availability };
}

/** Parse and check one file's text. Bad JSON is a fault like any other. */
export function parseFamilyFile(text: string, path: string): FamilyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new FamilyFileError(path, [`is not valid JSON: ${(e as Error).message}`]);
  }
  return checkFamilyData(parsed, path);
}

/* -- The write path ---------------------------------------------------------
 *
 * Writing the private file has to be as careful as reading it. Three guards,
 * and none of them is optional:
 *
 * 1. The value is checked before it is serialised, so a bad in-memory edit never
 *    reaches the disk.
 * 2. The serialised text is parsed and checked *again*, so the round trip is
 *    proved rather than assumed.
 * 3. The bytes land in a temp file in the same directory and are renamed over
 *    the target. Rename within a directory is atomic, so a reader sees the old
 *    file or the new one and never a half-written one.
 *
 * The file is JSON, so hand formatting and key order do not survive a write. The
 * data does, which is the property worth guarding.
 */

/** Field order for the written file. Stable output keeps diffs readable. */
export function serializeFamilyFile(file: FamilyFile): string {
  const ordered = {
    country: file.country,
    households: file.households,
    people: file.people,
    services: file.services,
    subscriptions: file.subscriptions,
    titles: file.titles,
    interests: file.interests,
    availability: file.availability,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Serialise, prove the result parses back, then swap it into place atomically.
 *
 * Refusing on a failed round trip is the point. The alternative is a family
 * losing real spend records to a file the app itself can no longer load.
 */
export function writeFamilyFile(path: string, file: FamilyFile): void {
  checkFamilyData(file, path); // guard 1: the value itself
  const text = serializeFamilyFile(file);
  parseFamilyFile(text, path); // guard 2: the bytes about to be written

  writeFileAtomic(path, text); // guard 3
}

/** What the app may change about one subscription from the screen. */
export interface SubscriptionStatusChange {
  subscriptionId: string;
  status: SubscriptionStatus;
  /** ISO date billing stopped. Required when pausing, ignored when resuming. */
  pausedOn?: string;
  /** ISO date the service is due back. The app owns this date. */
  resumeBy?: string;
}

/**
 * A copy of the file with one subscription's status changed. Pure, so the
 * decision is testable without touching a disk.
 *
 * Resuming clears `pausedOn` and `resumeBy` rather than leaving them behind.
 * The checker rejects an active row that still carries them, and it is right to:
 * a stale resume date is how a household gets nagged about a service it is
 * already paying for.
 */
export function withSubscriptionStatus(
  file: FamilyFile,
  change: SubscriptionStatusChange,
): FamilyFile {
  const found = file.subscriptions.some((s) => s.id === change.subscriptionId);
  if (!found) {
    throw new Error(`No subscription "${change.subscriptionId}" in this dataset.`);
  }

  return {
    ...file,
    subscriptions: file.subscriptions.map((sub) => {
      if (sub.id !== change.subscriptionId) return sub;
      const { status: _s, pausedOn: _p, resumeBy: _r, ...rest } = sub;
      if (change.status === 'active') return { ...rest, status: 'active' as const };
      const paused: Subscription = { ...rest, status: 'paused', pausedOn: change.pausedOn };
      if (change.resumeBy !== undefined) paused.resumeBy = change.resumeBy;
      return paused;
    }),
  };
}
