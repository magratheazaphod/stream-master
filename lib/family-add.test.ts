/**
 * What a family member may add, and what the app refuses to let them write.
 *
 * The governing assertion is the last group: a form must not be able to write
 * something `parseFamilyFile` would reject, because the day it can is the day
 * the app cannot read its own data back. Everything above it is the forgiveness
 * that makes the form usable without making the stored value vague.
 */

import { describe, expect, it } from 'vitest';
import {
  AdditionError,
  makeId,
  parseDate,
  parseMoney,
  withAddition,
  type CatalogAddition,
} from './family-add';
import { parseFamilyFile, serializeFamilyFile, type FamilyFile } from './family-file';

const base = (): FamilyFile => ({
  country: 'US',
  households: [
    { id: 'h-ashby', name: 'Ashby', location: 'Portland, OR' },
    { id: 'h-fairhaven', name: 'Fairhaven', location: 'Boston, MA' },
  ],
  people: [
    { id: 'p-jesse', name: 'Jesse', householdId: 'h-ashby' },
    { id: 'p-peter', name: 'Peter', householdId: 'h-fairhaven' },
  ],
  services: [{ id: 'svc-netflix', name: 'Netflix', monthlyPrice: 17.99, sharingPolicy: 'extra-member' }],
  subscriptions: [],
  titles: [],
  interests: [],
  availability: {},
});

const add = (addition: CatalogAddition, file: FamilyFile = base()) => withAddition(file, addition);

describe('parseMoney', () => {
  it('takes money as somebody types it', () => {
    expect(parseMoney('12.99', 'Cost')).toBe(12.99);
    expect(parseMoney(' $12.99 ', 'Cost')).toBe(12.99);
    expect(parseMoney('$1,299.00', 'Cost')).toBe(1299);
    expect(parseMoney('12,99', 'Cost')).toBe(12.99);
    expect(parseMoney('8', 'Cost')).toBe(8);
    expect(parseMoney(0, 'Cost')).toBe(0);
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(() => parseMoney('about twelve', 'Cost')).toThrow(AdditionError);
    expect(() => parseMoney('', 'Cost')).toThrow(AdditionError);
    expect(() => parseMoney('12.9999', 'Cost')).toThrow(AdditionError);
    expect(() => parseMoney(-3, 'Cost')).toThrow(AdditionError);
  });

  it('names the field it refused, so the form can point at it', () => {
    expect(() => parseMoney('nope', 'The monthly price')).toThrow(/The monthly price/);
  });
});

describe('parseDate', () => {
  it('takes both shapes this family writes and stores one', () => {
    expect(parseDate('2026-09-01', 'Renewal')).toBe('2026-09-01');
    expect(parseDate('2026-9-1', 'Renewal')).toBe('2026-09-01');
    expect(parseDate('9/1/2026', 'Renewal')).toBe('2026-09-01');
  });

  it('refuses a date that does not exist', () => {
    expect(() => parseDate('2026-02-30', 'Renewal')).toThrow(AdditionError);
    expect(() => parseDate('2026-13-01', 'Renewal')).toThrow(AdditionError);
  });

  // A two-digit year is genuinely ambiguous and the app would rather ask again
  // than put the wrong renewal date in front of somebody who trusts it.
  it('refuses a two-digit year and free text', () => {
    expect(() => parseDate('9/1/26', 'Renewal')).toThrow(AdditionError);
    expect(() => parseDate('next tuesday', 'Renewal')).toThrow(AdditionError);
  });
});

describe('makeId', () => {
  it('reads as the thing it names', () => {
    expect(makeId('svc', 'Paramount+', [])).toBe('svc-paramount');
  });

  it('never collides with an id already in use', () => {
    expect(makeId('p', 'Peter', ['p-peter'])).toBe('p-peter-2');
    expect(makeId('p', 'Peter', ['p-peter', 'p-peter-2'])).toBe('p-peter-3');
  });

  it('still produces an id for a name that slugs to nothing', () => {
    expect(makeId('h', '...', [])).toBe('h-new');
  });
});

describe('adding a household', () => {
  it('brings its first person with it', () => {
    const { file, added } = add({
      kind: 'household',
      name: 'Rowan Street',
      location: 'Seattle, WA',
      firstPersonName: 'Shan',
    });
    expect(added.households).toEqual(['h-rowan-street']);
    expect(added.people).toEqual(['p-shan']);
    expect(file.people.find((p) => p.id === 'p-shan')?.householdId).toBe('h-rowan-street');
  });

  it('refuses a household with no location', () => {
    expect(() =>
      add({ kind: 'household', name: 'Nowhere', location: '  ', firstPersonName: 'Shan' }),
    ).toThrow(AdditionError);
  });
});

describe('adding a person', () => {
  it('lands them in an existing household', () => {
    const { file } = add({ kind: 'person', name: 'Shan', householdId: 'h-ashby' });
    expect(file.people.at(-1)).toEqual({ id: 'p-shan', name: 'Shan', householdId: 'h-ashby' });
  });

  // The join has to hold. The checker catches this, which is the point of
  // routing every addition through it rather than validating the row alone.
  it('refuses a household that does not exist', () => {
    expect(() => add({ kind: 'person', name: 'Ghost', householdId: 'h-nowhere' })).toThrow(
      AdditionError,
    );
  });
});

describe('adding a service', () => {
  it('records the price and the sharing rule', () => {
    const { file } = add({
      kind: 'service',
      name: 'Britbox',
      monthlyPrice: '$8.99',
      sharingPolicy: 'household-only',
    });
    const service = file.services.at(-1)!;
    expect(service).toMatchObject({ id: 'svc-britbox', monthlyPrice: 8.99 });
  });

  /**
   * The honesty rule, and the reason this file exists rather than a generic
   * insert. Nobody has walked a new service's stop-billing flow, so it gets no
   * terms, no manage URL and no method, and the app then offers no pause button
   * for it. Defaulting any of the three would point a browser at a guessed page
   * on somebody's real account.
   */
  it('never invents pause terms', () => {
    const { file } = add({
      kind: 'service',
      name: 'Britbox',
      monthlyPrice: '8.99',
      sharingPolicy: 'household-only',
    });
    expect(file.services.at(-1)!.pause).toBeUndefined();
    expect(Object.keys(file.services.at(-1)!)).not.toContain('pause');
  });

  it('takes an extra-member price only when one is given', () => {
    expect(
      add({
        kind: 'service',
        name: 'Britbox',
        monthlyPrice: '8.99',
        sharingPolicy: 'extra-member',
        extraMemberPrice: '  ',
      }).file.services.at(-1)!.extraMemberPrice,
    ).toBeUndefined();
    expect(
      add({
        kind: 'service',
        name: 'Britbox',
        monthlyPrice: '8.99',
        sharingPolicy: 'extra-member',
        extraMemberPrice: '6.99',
      }).file.services.at(-1)!.extraMemberPrice,
    ).toBe(6.99);
  });

  it('refuses a sharing rule the domain does not have', () => {
    expect(() =>
      add({ kind: 'service', name: 'Britbox', monthlyPrice: '8.99', sharingPolicy: 'anybody' }),
    ).toThrow(AdditionError);
  });
});

describe('adding a subscription', () => {
  const peters: CatalogAddition = {
    kind: 'subscription',
    serviceId: 'svc-netflix',
    householdId: 'h-fairhaven',
    payerId: 'p-peter',
    monthlyCost: '$24.99',
    billingCycle: 'monthly',
    renewsOn: '9/14/2026',
  };

  it('stores an exact number and an ISO date from forgiving input', () => {
    const { file } = add(peters);
    expect(file.subscriptions.at(-1)).toEqual({
      id: 'sub-svc-netflix-h-fairhaven',
      serviceId: 'svc-netflix',
      householdId: 'h-fairhaven',
      payerId: 'p-peter',
      monthlyCost: 24.99,
      billingCycle: 'monthly',
      renewsOn: '2026-09-14',
    });
  });

  it('starts active, with no pause dates to go stale', () => {
    const row = add(peters).file.subscriptions.at(-1)!;
    expect(row.status).toBeUndefined();
    expect(row.pausedOn).toBeUndefined();
    expect(row.resumeBy).toBeUndefined();
  });

  // Two rows for one service in one household double the spend total silently,
  // and the spend total is the number this app exists to get right.
  it('refuses a second row for a service the household already has', () => {
    const { file } = add(peters);
    expect(() => add(peters, file)).toThrow(/already has this service/);
  });

  it('refuses a payer nobody defines', () => {
    expect(() => add({ ...peters, payerId: 'p-nobody' })).toThrow(AdditionError);
  });

  it('refuses a service nobody defines', () => {
    expect(() => add({ ...peters, serviceId: 'svc-nothing' })).toThrow(AdditionError);
  });
});

/**
 * The rule the whole module is built around. Anything an addition produces has
 * to survive the private file's own round trip, because that is the loader that
 * runs on every request and the one that refuses to degrade to demo data.
 */
describe('everything written stays loadable', () => {
  it('round-trips through parseFamilyFile', () => {
    let file = base();
    file = withAddition(file, {
      kind: 'household',
      name: 'Rowan Street',
      location: 'Seattle, WA',
      firstPersonName: 'Shan',
    }).file;
    file = withAddition(file, {
      kind: 'service',
      name: 'Britbox',
      monthlyPrice: '$8.99',
      sharingPolicy: 'household-only',
    }).file;
    file = withAddition(file, {
      kind: 'subscription',
      serviceId: 'svc-britbox',
      householdId: 'h-rowan-street',
      payerId: 'p-shan',
      monthlyCost: '8,99',
      billingCycle: 'annual',
      renewsOn: '1/2/2027',
    }).file;

    const reloaded = parseFamilyFile(serializeFamilyFile(file), 'round-trip');
    expect(reloaded.subscriptions.at(-1)).toMatchObject({
      monthlyCost: 8.99,
      renewsOn: '2027-01-02',
      billingCycle: 'annual',
    });
    expect(reloaded.services.find((s) => s.id === 'svc-britbox')!.pause).toBeUndefined();
  });

  it('leaves the previous data untouched when it refuses', () => {
    const file = base();
    const before = serializeFamilyFile(file);
    expect(() => withAddition(file, { kind: 'person', name: '', householdId: 'h-ashby' })).toThrow();
    expect(serializeFamilyFile(file)).toBe(before);
  });
});
