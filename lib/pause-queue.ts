/**
 * The Cowork seam, from this side.
 *
 * The app records intent. It cannot stop anybody's billing: no streaming
 * provider exposes subscription management to third parties, so a real pause
 * means driving a logged-in browser, and Claude Cowork does that. Cowork's shell
 * runs in a VM with no route to this app's port, so the two sides talk through
 * files in `data/` and never through a request.
 *
 * `docs/pause-automation.md` is the contract. Everything here implements it and
 * nothing here invents beyond it.
 *
 * The honesty rule this module exists to enforce: a request is a request. Until
 * a result comes back with `outcome: "done"` and the confirmation text the agent
 * actually read, the app says pending. It never says saved.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFile } from './atomic-write';
import type { PauseMethod, ServiceId, SubscriptionStatus } from './types';

export const PAUSE_QUEUE_PATH = join(process.cwd(), 'data', 'pause-queue.json');
export const PAUSE_RESULTS_PATH = join(process.cwd(), 'data', 'pause-results.json');

/** Both files carry a version so a contract change is a loud failure. */
export const PAUSE_CONTRACT_VERSION = 1;

export type PauseAction = 'pause' | 'resume';

/** One thing the family asked Cowork to do. Shape fixed by the contract. */
export interface PauseRequest {
  id: string;
  subscriptionId: string;
  serviceId: ServiceId;
  serviceName: string;
  householdName: string;
  action: PauseAction;
  method: PauseMethod;
  manageUrl: string;
  /**
   * The gate, and it is load-bearing. Cowork skips anything that is not exactly
   * true. Execution runs unattended; the decision does not.
   */
  approved: boolean;
  /**
   * When the second household said yes. Absent while a request is still waiting
   * for one, which is the only state in which `approved` is false.
   */
  approvedAt?: string;
  /**
   * Who raised it, and from which household.
   *
   * The household is the load-bearing half. Approval requires a person from a
   * different one, so the request has to remember where it came from - a name
   * alone cannot answer "is this a second pair of eyes or the same person
   * pressing twice".
   *
   * Optional because a queue file written before the two-household rule existed
   * still parses. A request with no requesting household cannot be checked
   * against one, and the app refuses to approve it rather than waving it
   * through.
   */
  requestedBy?: string;
  requestedHousehold?: string;
  /** The household that approved. Recorded so the pair is auditable after the fact. */
  approvedHousehold?: string;
  /**
   * Who said yes, by name.
   *
   * Optional, and it has to be: a queue file written before this field existed
   * still parses. Absent means nobody claimed it, never that the request is
   * unapproved - `approved` alone is the gate and this field never touches it.
   *
   * Attribution and not proof. Everyone shares one password, so this records who
   * said they pressed the button rather than who provably did. For an
   * irreversible action an unattended agent executes, a name somebody chose is
   * still worth more than an anonymous `true`.
   */
  approvedBy?: string;
  resumeBy?: string;
  notes?: string;
}

export interface PauseQueueFile {
  version: number;
  writtenAt: string;
  requests: PauseRequest[];
}

export type PauseOutcome = 'done' | 'already' | 'blocked' | 'failed' | 'skipped';

export interface PauseResult {
  requestId: string;
  outcome: PauseOutcome;
  observedAt: string;
  billingStopsOn?: string;
  evidence?: string;
  screenshot?: string;
}

export interface PauseResultsFile {
  version: number;
  writtenAt: string;
  results: PauseResult[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const OUTCOMES: PauseOutcome[] = ['done', 'already', 'blocked', 'failed', 'skipped'];

/* -- Reading ---------------------------------------------------------------- */

/**
 * The queue as it stands, or an empty one.
 *
 * A missing file is the ordinary state before anyone presses anything. A file
 * that will not parse is not: it means an interrupted write or a hand edit, and
 * appending to a queue we cannot read would drop whatever it held.
 */
export function readQueue(path: string = PAUSE_QUEUE_PATH): PauseQueueFile {
  if (!existsSync(path)) {
    return { version: PAUSE_CONTRACT_VERSION, writtenAt: new Date(0).toISOString(), requests: [] };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.requests)) {
    throw new Error(`${path} is not a pause queue. Fix or remove it before pausing again.`);
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : PAUSE_CONTRACT_VERSION,
    writtenAt: typeof parsed.writtenAt === 'string' ? parsed.writtenAt : new Date(0).toISOString(),
    requests: parsed.requests as PauseRequest[],
  };
}

/**
 * What Cowork reported. Read defensively and never throw: this file is written
 * by the other side of the seam, and a malformed one must not take the screen
 * down. An unreadable result file means we know nothing, which is exactly the
 * state the UI already renders honestly.
 */
export function readResults(path: string = PAUSE_RESULTS_PATH): PauseResult[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.results)) return [];
    return parsed.results.filter(
      (r): r is PauseResult =>
        isObject(r) &&
        typeof r.requestId === 'string' &&
        typeof r.outcome === 'string' &&
        OUTCOMES.includes(r.outcome as PauseOutcome),
    );
  } catch {
    return [];
  }
}

/* -- Writing ---------------------------------------------------------------- */

/**
 * Deterministic from the date, the service and the household, per the ids in the
 * contract. Two presses of the same button on the same day are one request, not
 * two, and a queue that tells Cowork to cancel the same subscription twice is
 * how a household ends up cancelling something it already cancelled.
 */
export function requestId(day: string, serviceId: ServiceId, householdName: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `req-${day}-${slug(serviceId)}-${slug(householdName)}`;
}

/**
 * Add one request to the queue and write the file atomically.
 *
 * Replaces any request carrying the same id rather than appending a duplicate,
 * so a double press is idempotent. Returns the queue as written, so the caller
 * reports what is actually on disk instead of what it hoped for.
 */
export function appendRequest(
  request: PauseRequest,
  path: string = PAUSE_QUEUE_PATH,
  now: Date = new Date(),
): PauseQueueFile {
  const current = readQueue(path);
  const next: PauseQueueFile = {
    version: PAUSE_CONTRACT_VERSION,
    writtenAt: now.toISOString(),
    requests: [...current.requests.filter((r) => r.id !== request.id), request],
  };
  writeJsonFile(path, next);
  return next;
}

/**
 * Take one request back out of the queue file.
 *
 * Withdrawing is the safe direction, so this is deliberately forgiving: an id
 * that is not there leaves the file as it was rather than throwing. The caller
 * has already decided the request may go.
 */
export function removeRequest(
  requestId: string,
  path: string = PAUSE_QUEUE_PATH,
  now: Date = new Date(),
): PauseQueueFile {
  const current = readQueue(path);
  const next: PauseQueueFile = {
    version: PAUSE_CONTRACT_VERSION,
    writtenAt: now.toISOString(),
    requests: current.requests.filter((r) => r.id !== requestId),
  };
  writeJsonFile(path, next);
  return next;
}

/* -- What the screen may say ------------------------------------------------ */

/**
 * How far along one request is, in the only vocabulary the UI is allowed to use.
 *
 * `confirmed` is the single value that lets the screen speak about money stopping,
 * and it requires a `done` result carrying evidence. A `done` with no evidence is
 * an agent that clicked a button and assumed, which the contract calls `failed`.
 */
export type PauseProgress =
  | 'none' // nobody has asked
  | 'awaiting-approval' // one household asked, and a second has not agreed yet
  | 'requested' // approved, and no agent can see it yet
  | 'in-flight' // in the queue file, waiting on Cowork's next run
  | 'confirmed' // done, with the confirmation text the agent read
  | 'unconfirmed' // done or already, but no evidence came with it
  | 'needs-a-person' // blocked: a CAPTCHA, a re-auth, an unexpected screen
  | 'failed'; // attempted and did not complete, or skipped

export interface PauseState {
  progress: PauseProgress;
  request?: PauseRequest;
  result?: PauseResult;
}

/** The newest result for a request. Cowork appends, so later rows win. */
export function latestResultFor(results: PauseResult[], id: string): PauseResult | undefined {
  return results.filter((r) => r.requestId === id).at(-1);
}

/**
 * The current state of the newest request against one subscription.
 *
 * Reads the queue and the results together, because either alone lies: a request
 * with no result reads as done if you only look at the queue, and a stale result
 * reads as current if you only look at the results.
 *
 * `handedOff` is the third input and it exists because the hosted app cannot
 * reach Cowork directly. A request sits in Postgres until the sync job on
 * Jesse's Mac pulls it into the queue file, and if the Mac is asleep it sits
 * there for hours. Until it moves, nothing is going to happen and the screen
 * says so. The default answers no, which is the safe reading: a caller that
 * cannot say whether a request reached an agent must not imply one is standing
 * by. The file store answers yes for everything in the queue, because writing
 * that file is the handoff.
 */
export function pauseStateFor(
  subscriptionId: string,
  queue: PauseQueueFile,
  results: PauseResult[],
  handedOff: (requestId: string) => boolean = () => false,
): PauseState {
  const request = queue.requests.filter((r) => r.subscriptionId === subscriptionId).at(-1);
  if (!request) return { progress: 'none' };

  const result = latestResultFor(results, request.id);
  // Unapproved outranks everything else a request could be. Nothing is going to
  // happen, and nothing should read as though it might.
  if (!request.approved) return { progress: 'awaiting-approval', request };
  if (!result) return { progress: handedOff(request.id) ? 'in-flight' : 'requested', request };

  const progress: PauseProgress =
    result.outcome === 'done' || result.outcome === 'already'
      ? result.evidence && result.evidence.trim() !== ''
        ? 'confirmed'
        : 'unconfirmed'
      : result.outcome === 'blocked'
        ? 'needs-a-person'
        : 'failed';

  return { progress, request, result };
}

/**
 * Whether the app may treat a subscription's own `status` as money actually
 * stopped. Only a confirmed pause counts. Everything else is intent, and the
 * whole product rests on never telling a family they saved money they did not.
 */
export function isMoneyStopped(state: PauseState, status: SubscriptionStatus): boolean {
  return status === 'paused' && state.progress === 'confirmed';
}
