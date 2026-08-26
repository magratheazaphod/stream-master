/**
 * The write path, asserted.
 *
 * Reading the private file is already guarded loudly. Writing it has to be
 * guarded the same way, and the property under test is blunt: after any failed
 * write, `data/family.json` holds exactly what it held before. Losing a family's
 * real spend record to a half-written file is the worst outcome available here,
 * and it is the one these tests exist to forbid.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setSubscriptionStatusInFile as setSubscriptionStatus } from './store/file';
import {
  FamilyFileError,
  parseFamilyFile,
  withSubscriptionStatus,
  writeFamilyFile,
} from './family-file';

const dirs: string[] = [];

function tempPath(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'stream-master-write-'));
  dirs.push(dir);
  const path = join(dir, 'family.json');
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const valid = {
  country: 'US',
  households: [{ id: 'h1', name: 'Ours', location: 'Somewhere' }],
  people: [{ id: 'p1', name: 'Real Person', householdId: 'h1' }],
  services: [
    {
      id: 's1',
      name: 'Service',
      monthlyPrice: 10,
      sharingPolicy: 'household-only',
      pause: {
        method: 'native-pause',
        manageUrl: 'https://example.test/account',
        maxPauseMonths: 3,
        costs: ['downloads'],
        verifiedOn: '2026-07-20',
      },
    },
  ],
  subscriptions: [
    {
      id: 'sub1',
      serviceId: 's1',
      householdId: 'h1',
      payerId: 'p1',
      monthlyCost: 10,
      billingCycle: 'monthly',
      renewsOn: '2026-09-01',
      status: 'active',
    },
  ],
  titles: [{ id: 't1', name: 'Something', year: 2025, kind: 'series', plannedMonth: 0 }],
  interests: [{ titleId: 't1', personId: 'p1' }],
  availability: { t1: { series: [{ serviceId: 's1', kind: 'flatrate' }] } },
};

const load = (path: string) => parseFamilyFile(readFileSync(path, 'utf8'), path);

describe('withSubscriptionStatus', () => {
  it('records the pause dates the type asks for', () => {
    const next = withSubscriptionStatus(parseFamilyFile(JSON.stringify(valid), 'x'), {
      subscriptionId: 'sub1',
      status: 'paused',
      pausedOn: '2026-08-26',
      resumeBy: '2026-11-26',
    });
    expect(next.subscriptions[0]).toMatchObject({
      status: 'paused',
      pausedOn: '2026-08-26',
      resumeBy: '2026-11-26',
    });
  });

  // A stale resume date on a live row is how a household gets nagged about a
  // service it is already paying for.
  it('clears the pause dates on resume rather than leaving them behind', () => {
    const paused = withSubscriptionStatus(parseFamilyFile(JSON.stringify(valid), 'x'), {
      subscriptionId: 'sub1',
      status: 'paused',
      pausedOn: '2026-08-26',
      resumeBy: '2026-11-26',
    });
    const resumed = withSubscriptionStatus(paused, { subscriptionId: 'sub1', status: 'active' });
    expect(resumed.subscriptions[0].status).toBe('active');
    expect(resumed.subscriptions[0].pausedOn).toBeUndefined();
    expect(resumed.subscriptions[0].resumeBy).toBeUndefined();
  });

  it('refuses a subscription the dataset does not hold', () => {
    expect(() =>
      withSubscriptionStatus(parseFamilyFile(JSON.stringify(valid), 'x'), {
        subscriptionId: 'nope',
        status: 'active',
      }),
    ).toThrow(/No subscription/);
  });

  it('does not mutate the file it was handed', () => {
    const file = parseFamilyFile(JSON.stringify(valid), 'x');
    withSubscriptionStatus(file, { subscriptionId: 'sub1', status: 'paused', pausedOn: '2026-08-26' });
    expect(file.subscriptions[0].status).toBe('active');
  });
});

describe('writeFamilyFile', () => {
  it('writes something the reader accepts back', () => {
    const path = tempPath(JSON.stringify(valid));
    const next = withSubscriptionStatus(load(path), {
      subscriptionId: 'sub1',
      status: 'paused',
      pausedOn: '2026-08-26',
      resumeBy: '2026-11-26',
    });
    writeFamilyFile(path, next);
    expect(load(path).subscriptions[0].status).toBe('paused');
  });

  it('keeps every other row and field intact', () => {
    const path = tempPath(JSON.stringify(valid));
    writeFamilyFile(
      path,
      withSubscriptionStatus(load(path), {
        subscriptionId: 'sub1',
        status: 'paused',
        pausedOn: '2026-08-26',
      }),
    );
    const after = load(path);
    expect(after.country).toBe('US');
    expect(after.services[0].pause?.manageUrl).toBe('https://example.test/account');
    expect(after.titles).toHaveLength(1);
    expect(after.availability.t1).toBeDefined();
  });

  // Guard 1: a bad in-memory edit never reaches the disk at all.
  it('refuses a value that would not load, leaving the file untouched', () => {
    const path = tempPath(JSON.stringify(valid));
    const before = readFileSync(path, 'utf8');
    const broken = load(path);
    // Paused with no pausedOn: a row nobody could trust to resume.
    broken.subscriptions[0] = { ...broken.subscriptions[0], status: 'paused' };
    expect(() => writeFamilyFile(path, broken)).toThrow(FamilyFileError);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('leaves no temp file behind when it refuses', () => {
    const path = tempPath(JSON.stringify(valid));
    const broken = load(path);
    broken.subscriptions[0] = { ...broken.subscriptions[0], status: 'paused' };
    expect(() => writeFamilyFile(path, broken)).toThrow();
    expect(readdirSync(dirname(path)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('setSubscriptionStatus', () => {
  it('persists against the private file', () => {
    const path = tempPath(JSON.stringify(valid));
    const result = setSubscriptionStatus(
      { subscriptionId: 'sub1', status: 'paused', pausedOn: '2026-08-26' },
      path,
    );
    expect(result).toMatchObject({ source: 'private', persisted: true });
    expect(load(path).subscriptions[0].status).toBe('paused');
  });

  it('round trips a pause and a resume', () => {
    const path = tempPath(JSON.stringify(valid));
    setSubscriptionStatus({ subscriptionId: 'sub1', status: 'paused', pausedOn: '2026-08-26' }, path);
    setSubscriptionStatus({ subscriptionId: 'sub1', status: 'active' }, path);
    expect(load(path).subscriptions[0].status).toBe('active');
    expect(load(path).subscriptions[0].pausedOn).toBeUndefined();
  });

  // The demo dataset is a fixture in the bundle. A toggle pressed against it must
  // never conjure a data/family.json, because a file that appears by accident is
  // one nobody can tell apart from real household data later.
  it('changes nothing on disk when the app is running on demo data', () => {
    const path = tempPath();
    const result = setSubscriptionStatus(
      { subscriptionId: 'sub-1', status: 'paused', pausedOn: '2026-08-26' },
      path,
    );
    expect(result).toMatchObject({ source: 'demo', persisted: false });
    expect(result.subscription.status).toBe('paused');
    expect(existsSync(path)).toBe(false);
  });

  it('refuses to write over a private file it cannot read', () => {
    const path = tempPath('{ not json');
    expect(() =>
      setSubscriptionStatus({ subscriptionId: 'sub1', status: 'active' }, path),
    ).toThrow(FamilyFileError);
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
  });
});
