/**
 * The file store behind the seam, and the state the hosted app added.
 *
 * `lib/catalog.test.ts` already asserts the demo-versus-private rule against
 * the file reader directly. What is tested here is the store wrapper: that it
 * carries that rule through the interface unchanged, and that it reports every
 * queued request as handed off, because on one machine writing the file *is*
 * the handoff and there is nothing to wait for.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCatalogStore } from './file';
import { pauseStateFrom } from './pause-state';
import type { PauseRequest } from '../pause-queue';

let dir: string;
let familyPath: string;
let queuePath: string;
let resultsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-store-'));
  familyPath = join(dir, 'family.json');
  queuePath = join(dir, 'pause-queue.json');
  resultsPath = join(dir, 'pause-results.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = () => new FileCatalogStore(familyPath, queuePath, resultsPath);

const family = {
  country: 'US',
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
  availability: {},
};

const request = (over: Partial<PauseRequest> = {}): PauseRequest => ({
  id: 'req-2026-08-26-s1-ours',
  subscriptionId: 'sub1',
  serviceId: 's1',
  serviceName: 'Service',
  householdName: 'Ours',
  action: 'pause',
  method: 'cancel-resubscribe',
  manageUrl: 'https://example.test/cancel',
  approved: true,
  approvedAt: '2026-08-26T14:01:44.000Z',
  ...over,
});

describe('the file store', () => {
  it('serves the demo dataset when no private file exists', async () => {
    const loaded = await store().load();
    expect(loaded.source).toBe('demo');
    expect(loaded.path).toBeNull();
  });

  it('serves the private dataset when the file checks out', async () => {
    writeFileSync(familyPath, JSON.stringify(family));
    const loaded = await store().load();
    expect(loaded.source).toBe('private');
    expect(loaded.catalog.people.map((p) => p.name)).toEqual(['Real Person']);
  });

  it('throws rather than falling back when the private file is broken', async () => {
    writeFileSync(familyPath, '{ nope');
    await expect(store().load()).rejects.toThrow(/will not fall back to demo data/);
  });

  it('writes nothing against the demo dataset', async () => {
    const result = await store().setSubscriptionStatus({
      subscriptionId: 'sub-1',
      status: 'paused',
      pausedOn: '2026-08-26',
    });
    expect(result.source).toBe('demo');
    expect(result.persisted).toBe(false);
    // The point: no data/family.json appeared. A file nobody meant to create is
    // a file nobody can tell apart from real household data later.
    await expect(store().load()).resolves.toMatchObject({ source: 'demo' });
  });

  it('persists against the private file', async () => {
    writeFileSync(familyPath, JSON.stringify(family));
    const result = await store().setSubscriptionStatus({
      subscriptionId: 'sub1',
      status: 'paused',
      pausedOn: '2026-08-26',
    });
    expect(result).toMatchObject({ source: 'private', persisted: true });
    const reloaded = await store().load();
    expect(reloaded.catalog.subscriptions[0].status).toBe('paused');
  });

  // One machine, one disk. There is no sync job to wait for, so a request in
  // the queue file is already as far along as it can get before Cowork runs.
  it('reports a queued request as already with the agent', async () => {
    await store().queuePauseRequest(request());
    const snapshot = await store().pauseSnapshot();
    expect(snapshot.requests[0].handedOffAt).toBeDefined();
    expect(pauseStateFrom('sub1', snapshot).progress).toBe('in-flight');
  });

  it('replaces a request carrying the same id instead of duplicating it', async () => {
    await store().queuePauseRequest(request());
    await store().queuePauseRequest(request({ action: 'resume' }));
    const snapshot = await store().pauseSnapshot();
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0].request.action).toBe('resume');
  });

  it('reports an empty snapshot rather than throwing on a broken queue file', async () => {
    writeFileSync(queuePath, 'not a queue at all');
    await expect(store().pauseSnapshot()).resolves.toEqual({ requests: [], results: [] });
  });
});

describe('reading a snapshot for the screen', () => {
  it('separates a request nothing has picked up from one with the agent', () => {
    const waiting = { requests: [{ request: request() }], results: [] };
    expect(pauseStateFrom('sub1', waiting).progress).toBe('requested');

    const collected = {
      requests: [{ request: request(), handedOffAt: '2026-08-26T14:05:00.000Z' }],
      results: [],
    };
    expect(pauseStateFrom('sub1', collected).progress).toBe('in-flight');
  });

  // A result outranks both. Once Cowork has answered, where the request sat is
  // no longer the interesting fact about it.
  it('lets a result outrank the handoff either way', () => {
    const results = [
      {
        requestId: 'req-2026-08-26-s1-ours',
        outcome: 'done' as const,
        observedAt: '2026-08-26T14:38:12.000Z',
        evidence: 'Membership ends September 14',
      },
    ];
    expect(pauseStateFrom('sub1', { requests: [{ request: request() }], results }).progress).toBe(
      'confirmed',
    );
  });
});
