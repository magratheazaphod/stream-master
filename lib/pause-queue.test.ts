import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRequest,
  isMoneyStopped,
  latestResultFor,
  pauseStateFor,
  removeRequest,
  readQueue,
  readResults,
  requestId,
  type PauseRequest,
  type PauseResult,
} from './pause-queue';

let dir: string;
let queuePath: string;
let resultsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pause-queue-'));
  queuePath = join(dir, 'pause-queue.json');
  resultsPath = join(dir, 'pause-results.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const request = (over: Partial<PauseRequest> = {}): PauseRequest => ({
  id: 'req-2026-08-26-s-netflix-fairhaven',
  subscriptionId: 'sub-7',
  serviceId: 's-netflix',
  serviceName: 'Netflix',
  householdName: 'Fairhaven',
  action: 'pause',
  method: 'cancel-resubscribe',
  manageUrl: 'https://www.netflix.com/cancelplan',
  approved: true,
  approvedAt: '2026-08-26T14:01:44Z',
  ...over,
});

describe('reading the queue', () => {
  it('treats a missing file as an empty queue, not an error', () => {
    expect(readQueue(queuePath).requests).toEqual([]);
  });

  it('refuses a file that is not a queue rather than appending over it', () => {
    writeFileSync(queuePath, '{"version":1}');
    expect(() => readQueue(queuePath)).toThrow(/not a pause queue/);
  });

  /**
   * `approvedBy` arrived after the contract shipped, so a queue written without
   * it has to keep working. Cowork's file contract is a contract: a field added
   * on this side must never turn an older file into a parse error.
   */
  it('reads a queue written before approvedBy existed', () => {
    const older = { ...request() } as Record<string, unknown>;
    writeFileSync(
      queuePath,
      JSON.stringify({ version: 1, writtenAt: '2026-08-20T00:00:00Z', requests: [older] }),
    );
    const read = readQueue(queuePath);
    expect(read.requests[0].approvedBy).toBeUndefined();
    expect(read.requests[0].approved).toBe(true);
  });
});

describe('writing the queue', () => {
  // Attribution and not proof: everybody shares one password, so the name says
  // who claimed the decision. It never touches `approved`, which stays the gate.
  it('carries the approving person without gating on them', () => {
    appendRequest(request({ approvedBy: 'Peter' }), queuePath);
    const written = JSON.parse(readFileSync(queuePath, 'utf8')) as { requests: PauseRequest[] };
    expect(written.requests[0].approvedBy).toBe('Peter');

    appendRequest(request({ id: 'req-anon' }), queuePath);
    const both = readQueue(queuePath).requests;
    expect(both.find((r) => r.id === 'req-anon')!.approvedBy).toBeUndefined();
    expect(both.every((r) => r.approved === true)).toBe(true);
  });

  it('writes the contract shape Cowork reads', () => {
    appendRequest(request(), queuePath, new Date('2026-08-26T14:02:00Z'));
    const written = JSON.parse(readFileSync(queuePath, 'utf8'));
    expect(written.version).toBe(1);
    expect(written.writtenAt).toBe('2026-08-26T14:02:00.000Z');
    expect(written.requests).toHaveLength(1);
    expect(written.requests[0].approved).toBe(true);
  });

  it('keeps earlier requests when a second one lands', () => {
    appendRequest(request(), queuePath);
    appendRequest(request({ id: 'req-b', subscriptionId: 'sub-2' }), queuePath);
    expect(readQueue(queuePath).requests.map((r) => r.id)).toEqual([
      'req-2026-08-26-s-netflix-fairhaven',
      'req-b',
    ]);
  });

  // A second press must not tell Cowork to cancel the same subscription twice.
  it('replaces a request carrying the same id instead of duplicating it', () => {
    appendRequest(request(), queuePath);
    appendRequest(request({ action: 'resume' }), queuePath);
    const { requests } = readQueue(queuePath);
    expect(requests).toHaveLength(1);
    expect(requests[0].action).toBe('resume');
  });

  it('derives one id per service, household and day', () => {
    expect(requestId('2026-08-26', 's-netflix', 'Fairhaven')).toBe(
      'req-2026-08-26-s-netflix-fairhaven',
    );
  });

  it('leaves the previous queue intact when the write cannot happen', () => {
    appendRequest(request(), queuePath);
    const before = readFileSync(queuePath, 'utf8');
    // A directory standing where the file has to go. The rename cannot land.
    mkdirSync(join(dir, 'blocked.json'));
    expect(() => appendRequest(request({ id: 'req-b' }), join(dir, 'blocked.json'))).toThrow();
    expect(readFileSync(queuePath, 'utf8')).toBe(before);
  });
});

describe('reading results', () => {
  it('reports nothing rather than throwing when the file is unreadable', () => {
    writeFileSync(resultsPath, 'not json at all');
    expect(readResults(resultsPath)).toEqual([]);
  });

  it('drops rows carrying an outcome the contract does not define', () => {
    writeFileSync(
      resultsPath,
      JSON.stringify({
        version: 1,
        results: [
          { requestId: 'a', outcome: 'done', observedAt: 'x' },
          { requestId: 'b', outcome: 'probably', observedAt: 'x' },
        ],
      }),
    );
    expect(readResults(resultsPath).map((r) => r.requestId)).toEqual(['a']);
  });

  it('takes the newest result for a request', () => {
    const results: PauseResult[] = [
      { requestId: 'a', outcome: 'blocked', observedAt: '1' },
      { requestId: 'a', outcome: 'done', observedAt: '2', evidence: 'read it' },
    ];
    expect(latestResultFor(results, 'a')?.outcome).toBe('done');
  });
});

describe('what the screen may say', () => {
  const queue = { version: 1, writtenAt: '2026-08-26T14:02:00Z', requests: [request()] };
  const id = 'req-2026-08-26-s-netflix-fairhaven';

  it('says nothing was asked when no request names the subscription', () => {
    expect(pauseStateFor('sub-1', queue, []).progress).toBe('none');
  });

  it('says requested while Cowork has not reported back', () => {
    expect(pauseStateFor('sub-7', queue, []).progress).toBe('requested');
  });

  // The hosted app cannot reach Cowork. A request waits in Postgres until the
  // sync job on the Mac takes it, and a family told "with the agent" while the
  // Mac sleeps is being told somebody is standing by when nobody is.
  it('separates a request nothing has picked up from one an agent can see', () => {
    expect(pauseStateFor('sub-7', queue, [], () => true).progress).toBe('in-flight');
    expect(pauseStateFor('sub-7', queue, [], () => false).progress).toBe('requested');
  });

  it('assumes nothing has picked a request up when nobody says otherwise', () => {
    expect(pauseStateFor('sub-7', queue, []).progress).toBe('requested');
  });

  it('confirms only on a done carrying the evidence the agent read', () => {
    const results: PauseResult[] = [
      { requestId: id, outcome: 'done', observedAt: '2026-08-26T14:38:12Z', evidence: 'Membership ends September 14' },
    ];
    expect(pauseStateFor('sub-7', queue, results).progress).toBe('confirmed');
  });

  // The contract's own words: an agent that clicked a button and assumed is
  // reporting failed, not done. The screen must not launder it into success.
  it('refuses to confirm a done with no evidence', () => {
    const results: PauseResult[] = [{ requestId: id, outcome: 'done', observedAt: 'x' }];
    expect(pauseStateFor('sub-7', queue, results).progress).toBe('unconfirmed');
  });

  it('reads blocked as needing a person', () => {
    const results: PauseResult[] = [{ requestId: id, outcome: 'blocked', observedAt: 'x' }];
    expect(pauseStateFor('sub-7', queue, results).progress).toBe('needs-a-person');
  });

  it.each(['failed', 'skipped'] as const)('reads %s as a failure', (outcome) => {
    const results: PauseResult[] = [{ requestId: id, outcome, observedAt: 'x' }];
    expect(pauseStateFor('sub-7', queue, results).progress).toBe('failed');
  });

  it('counts money as stopped only on a confirmed pause', () => {
    const confirmed: PauseResult[] = [
      { requestId: id, outcome: 'done', observedAt: 'x', evidence: 'read it' },
    ];
    expect(isMoneyStopped(pauseStateFor('sub-7', queue, confirmed), 'paused')).toBe(true);
    expect(isMoneyStopped(pauseStateFor('sub-7', queue, []), 'paused')).toBe(false);
    expect(isMoneyStopped(pauseStateFor('sub-7', queue, confirmed), 'active')).toBe(false);
  });
});

/**
 * The two-household rule, at the level the queue can enforce it.
 *
 * The gate is `approved`, and `pause-sync` pulls only approved rows. So the one
 * thing that must never slip is an unapproved request reading as anything an
 * agent might act on.
 */
describe('a request waiting on a second household', () => {
  it('reads as awaiting-approval, never as requested', () => {
    const queue = {
      version: 1,
      writtenAt: '2026-08-27T00:00:00Z',
      requests: [
        request({ approved: false, approvedAt: undefined, requestedHousehold: 'Duval St' }),
      ],
    };
    expect(pauseStateFor('sub-7', queue, []).progress).toBe('awaiting-approval');
  });

  // Even if the sync job somehow took it, an unapproved request must not read as
  // in-flight. Unapproved outranks every other thing the state could be.
  it('stays awaiting-approval even when something claims to have handed it off', () => {
    const queue = {
      version: 1,
      writtenAt: '2026-08-27T00:00:00Z',
      requests: [request({ approved: false, approvedAt: undefined })],
    };
    expect(pauseStateFor('sub-7', queue, [], () => true).progress).toBe('awaiting-approval');
  });

  it('becomes requested once a second household approves it', () => {
    const queue = {
      version: 1,
      writtenAt: '2026-08-27T00:00:00Z',
      requests: [
        request({
          approved: true,
          approvedAt: '2026-08-27T09:00:00Z',
          requestedHousehold: 'Duval St',
          approvedHousehold: 'Mom',
        }),
      ],
    };
    expect(pauseStateFor('sub-7', queue, []).progress).toBe('requested');
  });

  it('carries who asked and who agreed, so the pair is auditable', () => {
    const queue = {
      version: 1,
      writtenAt: '2026-08-27T00:00:00Z',
      requests: [
        request({
          requestedBy: 'Jesse',
          requestedHousehold: 'Duval St',
          approvedBy: 'Peter',
          approvedHousehold: 'Mom',
        }),
      ],
    };
    const state = pauseStateFor('sub-7', queue, []);
    expect(state.request?.requestedHousehold).toBe('Duval St');
    expect(state.request?.approvedHousehold).toBe('Mom');
  });
});

describe('taking a request back', () => {
  it('removes it from the queue file', () => {
    appendRequest(request(), queuePath);
    expect(readQueue(queuePath).requests).toHaveLength(1);
    removeRequest('req-2026-08-26-s-netflix-fairhaven', queuePath);
    expect(readQueue(queuePath).requests).toEqual([]);
  });

  // Withdrawing is the safe direction, so an id that is not there is not an error.
  it('leaves the file alone when the id is not there', () => {
    appendRequest(request(), queuePath);
    removeRequest('req-nothing-like-this', queuePath);
    expect(readQueue(queuePath).requests).toHaveLength(1);
  });
});
