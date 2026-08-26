import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRequest,
  isMoneyStopped,
  latestResultFor,
  pauseStateFor,
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
});

describe('writing the queue', () => {
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
