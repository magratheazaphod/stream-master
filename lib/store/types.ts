/**
 * The storage seam, and the only vocabulary either side of it may use.
 *
 * Nothing in this file names a file, a table, a column or a query. That is the
 * point: the app asks a store for the family's catalogue and gets back domain
 * types, and it cannot tell from the answer whether the bytes came off Jesse's
 * disk or out of Postgres. Two implementations satisfy this shape and a third
 * could without the pages noticing.
 *
 * Async throughout, including on the file store, which does not need it. A seam
 * whose synchronous half sets the signature is a seam that has to be rewritten
 * the first time a real network shows up, and this one already has.
 */

import type { Catalog } from '../domain';
import type { SubscriptionStatusChange } from '../family-file';
import type { PauseRequest, PauseResult } from '../pause-queue';
import type { CountryCode, Subscription } from '../types';

/**
 * The family is US-only today. Named here rather than assumed anywhere, so the
 * day a household moves the change lands in one place.
 */
export const DEFAULT_COUNTRY: CountryCode = 'US';

/**
 * Which dataset the app is running on. Rendered in the masthead on every page.
 *
 * This distinction survives the move to Postgres unchanged, and it matters more
 * now than it did, because there are two backends and only one of them is ever
 * the demo. Three outcomes, and only three: no private data gives demo, private
 * data that checks out gives private, and private data that does not throws and
 * never degrades to demo. A reader who cannot tell which family they are
 * looking at will eventually publish the wrong one.
 */
export type DatasetSource = 'demo' | 'private';

export interface LoadedCatalog {
  source: DatasetSource;
  /**
   * Where the private data came from, in words a person can act on: a path for
   * the file store, a description of the tables for Postgres. Null on demo, and
   * never a connection string.
   */
  path: string | null;
  catalog: Catalog;
}

/** What a toggle actually achieved, in the terms the screen has to report. */
export interface StatusWriteResult {
  source: DatasetSource;
  /** False on demo data. The change is real for this session and nothing more. */
  persisted: boolean;
  subscription: Subscription;
}

/**
 * One queued request plus the one thing the queue file cannot carry.
 *
 * `handedOffAt` never reaches `data/pause-queue.json`. Cowork's contract is
 * fixed and adding a field to it would make the agent aware of a machine it has
 * no business knowing about. This is the app's own bookkeeping: null means the
 * request is recorded and nothing more, a timestamp means it reached the file
 * an agent reads. See docs/pause-automation.md.
 */
export interface QueuedRequest {
  request: PauseRequest;
  /** ISO 8601 instant the request reached the queue file. */
  handedOffAt?: string;
}

/** Everything the screen needs to say how far each pause got. */
export interface PauseSnapshot {
  requests: QueuedRequest[];
  results: PauseResult[];
}

/**
 * A place the family's data lives.
 *
 * Implementations own the demo-versus-private decision themselves rather than
 * having it applied to their output, because only the store knows what "no
 * private data" looks like in its own terms - a missing file here, an empty set
 * of households there.
 */
export interface CatalogStore {
  /** For the operator, never for the family. Names the backend, not the credentials. */
  readonly name: string;

  load(): Promise<LoadedCatalog>;

  /**
   * Pause or resume one subscription, and say whether it survived the request.
   *
   * On private data the change is checked in full and persisted, so a refusal
   * leaves what was there exactly as it was. On demo data nothing is written
   * and `persisted` is false, which the screen states rather than hides.
   */
  setSubscriptionStatus(change: SubscriptionStatusChange): Promise<StatusWriteResult>;

  /**
   * Record one approved request for Cowork. Idempotent on the request id: two
   * presses of the same button on the same day are one request, because a queue
   * that tells an agent to cancel the same subscription twice is how a
   * household ends up cancelling something it already cancelled.
   */
  queuePauseRequest(request: PauseRequest): Promise<void>;

  /** The queue and the results together. Either alone lies about the other. */
  pauseSnapshot(): Promise<PauseSnapshot>;
}
