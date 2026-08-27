/**
 * A store's pause snapshot, read in the vocabulary the screen is allowed to use.
 *
 * `pauseStateFor` in `lib/pause-queue.ts` still owns every judgment - what
 * counts as confirmed, what a `done` with no evidence really is. This adapts a
 * snapshot to it, and adds the one thing the queue file cannot carry: whether
 * the request has reached a machine that can act on it.
 */

import { pauseStateFor, PAUSE_CONTRACT_VERSION, type PauseState } from '../pause-queue';
import type { PauseSnapshot } from './types';

export function pauseStateFrom(subscriptionId: string, snapshot: PauseSnapshot): PauseState {
  const handedOff = new Set(
    snapshot.requests.filter((q) => q.handedOffAt !== undefined).map((q) => q.request.id),
  );
  return pauseStateFor(
    subscriptionId,
    {
      version: PAUSE_CONTRACT_VERSION,
      writtenAt: new Date(0).toISOString(),
      requests: snapshot.requests.map((q) => q.request),
    },
    snapshot.results,
    (id) => handedOff.has(id),
  );
}
