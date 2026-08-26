/**
 * The safety property, asserted.
 *
 * The repository is public and the private file is not in it. What has to hold is
 * that the app can always tell you which of the two it loaded: absent means demo,
 * valid means private, and anything else throws. The fourth outcome - a bad
 * private file quietly serving demo data - is the one this file exists to forbid.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCatalogFromFile as loadCatalog } from './catalog';
import { FamilyFileError, parseFamilyFile } from './family-file';
import { people as demoPeople } from './demo-data';

const dirs: string[] = [];

/** A path in a fresh temp directory. Nothing is written unless a test writes it. */
function tempPath(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'stream-master-'));
  dirs.push(dir);
  const path = join(dir, 'family.json');
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** The smallest file that passes every check. */
const valid = {
  country: 'GB',
  households: [{ id: 'h1', name: 'Ours', location: 'Somewhere' }],
  people: [{ id: 'p1', name: 'Real Person', householdId: 'h1' }],
  services: [{ id: 's1', name: 'Service', monthlyPrice: 10, sharingPolicy: 'household-only' }],
  subscriptions: [
    {
      id: 'sub1',
      serviceId: 's1',
      householdId: 'h1',
      payerId: 'p1',
      monthlyCost: 10,
      billingCycle: 'monthly',
      renewsOn: '2026-09-01',
    },
  ],
  titles: [{ id: 't1', name: 'Something', year: 2025, kind: 'series', plannedMonth: 0 }],
  interests: [{ titleId: 't1', personId: 'p1' }],
  availability: { t1: { series: [{ serviceId: 's1', kind: 'flatrate' }] } },
};

const withValid = (patch: Record<string, unknown>) =>
  JSON.stringify({ ...valid, ...patch });

describe('loadCatalog', () => {
  it('serves the demo dataset when no private file exists', () => {
    const loaded = loadCatalog(tempPath());
    expect(loaded.source).toBe('demo');
    expect(loaded.path).toBeNull();
    expect(loaded.catalog.people).toEqual(demoPeople);
  });

  it('serves the private dataset when the file is there and checks out', () => {
    const path = tempPath(JSON.stringify(valid));
    const loaded = loadCatalog(path);
    expect(loaded.source).toBe('private');
    expect(loaded.path).toBe(path);
    expect(loaded.catalog.people.map((p) => p.name)).toEqual(['Real Person']);
    expect(loaded.catalog.country).toBe('GB');
  });

  it('throws rather than falling back when the file is not JSON', () => {
    expect(() => loadCatalog(tempPath('{ nope'))).toThrow(FamilyFileError);
  });

  it('throws rather than falling back when a table is missing', () => {
    const { subscriptions, ...partial } = valid;
    expect(() => loadCatalog(tempPath(JSON.stringify(partial)))).toThrow(/subscriptions/);
  });

  it('names the file in the error, and says it will not fall back', () => {
    const path = tempPath('{}');
    try {
      loadCatalog(path);
      expect.unreachable('a malformed private file must throw');
    } catch (e) {
      expect((e as Error).message).toContain(path);
      expect((e as Error).message).toContain('will not fall back to demo data');
    }
  });

  it('never returns demo data for a private file it rejected', () => {
    // The whole point. Every malformed shape throws, and none of them quietly
    // hands back the fictional cast under the label of real data.
    const bad = [
      '',
      'null',
      '[]',
      '{}',
      withValid({ households: [] }),
      withValid({ people: 'nobody' }),
      withValid({ services: [{ id: 's1', name: 'S', monthlyPrice: 'ten', sharingPolicy: 'x' }] }),
    ];
    for (const contents of bad) {
      expect(() => loadCatalog(tempPath(contents)), contents).toThrow();
    }
  });
});

describe('checking a private file', () => {
  const check = (patch: Record<string, unknown>) => () =>
    parseFamilyFile(withValid(patch), '/tmp/family.json');

  it('rejects a subscription pointing at a service the file does not define', () => {
    expect(
      check({ subscriptions: [{ ...valid.subscriptions[0], serviceId: 's-missing' }] }),
    ).toThrow(/names a service the file does not define: "s-missing"/);
  });

  it('rejects a person in a household the file does not define', () => {
    expect(check({ people: [{ id: 'p1', name: 'A', householdId: 'h-missing' }] })).toThrow(
      /names a household the file does not define/,
    );
  });

  it('rejects an interest in a title the file does not define', () => {
    expect(check({ interests: [{ titleId: 't-missing', personId: 'p1' }] })).toThrow(
      /names a title the file does not define/,
    );
  });

  it('rejects duplicate ids', () => {
    expect(check({ people: [valid.people[0], valid.people[0]] })).toThrow(/duplicate id "p1"/);
  });

  it('rejects a renewal date that is not an ISO date', () => {
    expect(check({ subscriptions: [{ ...valid.subscriptions[0], renewsOn: 'next tuesday' }] })).toThrow(
      /renewsOn must be an ISO date/,
    );
  });

  // The example is the only instruction most people will read, so it has to be a
  // file the checker would actually accept.
  it('accepts the committed example file', () => {
    const path = join(process.cwd(), 'data', 'family.example.json');
    expect(() => parseFamilyFile(readFileSync(path, 'utf8'), path)).not.toThrow();
  });

  it('accepts a service with no pause terms, because nobody has walked that flow', () => {
    const file = parseFamilyFile(withValid({}), '/tmp/family.json');
    expect(file.services[0].pause).toBeUndefined();
  });

  it('keeps recorded pause terms intact', () => {
    const pause = {
      method: 'native-pause',
      manageUrl: 'https://example.test/account',
      maxPauseMonths: 3,
      costs: ['downloads'],
      verifiedOn: '2026-07-20',
    };
    const file = parseFamilyFile(
      withValid({ services: [{ ...valid.services[0], pause }] }),
      '/tmp/family.json',
    );
    expect(file.services[0].pause).toEqual(pause);
  });

  it('rejects a native pause that does not say how long it may run', () => {
    const pause = {
      method: 'native-pause',
      manageUrl: 'https://example.test/account',
      costs: [],
      verifiedOn: '2026-07-20',
    };
    expect(check({ services: [{ ...valid.services[0], pause }] })).toThrow(
      /claims a native pause but does not say for how many months/,
    );
  });

  it('rejects a pause cost it does not recognise', () => {
    const pause = {
      method: 'cancel-resubscribe',
      manageUrl: 'https://example.test/account',
      costs: ['dignity'],
      verifiedOn: '2026-07-20',
    };
    expect(check({ services: [{ ...valid.services[0], pause }] })).toThrow(/costs\[0\] must be one of/);
  });

  it('rejects a paused subscription that does not say when it stopped', () => {
    expect(check({ subscriptions: [{ ...valid.subscriptions[0], status: 'paused' }] })).toThrow(
      /is paused but does not say when/,
    );
  });

  it('rejects an active subscription still carrying a resume date', () => {
    expect(
      check({ subscriptions: [{ ...valid.subscriptions[0], resumeBy: '2026-10-01' }] }),
    ).toThrow(/carries pausedOn or resumeBy while not paused/);
  });

  it('rejects a resume date that falls before the pause', () => {
    expect(
      check({
        subscriptions: [
          { ...valid.subscriptions[0], status: 'paused', pausedOn: '2026-08-01', resumeBy: '2026-07-01' },
        ],
      }),
    ).toThrow(/falls before pausedOn/);
  });

  it('rejects an availability entry keyed by an unknown title', () => {
    expect(check({ availability: { 't-missing': [] } })).toThrow(
      /keyed by a title the file does not define/,
    );
  });

  it('reports every fault at once, so one pass fixes the file', () => {
    try {
      parseFamilyFile(withValid({ households: [{ id: 'h1' }], titles: [{ id: 't1' }] }), '/f.json');
      expect.unreachable('a file with two faults must throw');
    } catch (e) {
      expect((e as FamilyFileError).faults.length).toBeGreaterThan(3);
    }
  });

  it('accepts a file with no availability recorded yet', () => {
    const { availability, ...noOffers } = valid;
    const family = parseFamilyFile(JSON.stringify(noOffers), '/f.json');
    expect(family.availability).toEqual({});
  });
});
