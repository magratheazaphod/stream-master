/**
 * The file-backed store: `data/family.json` and the two Cowork files beside it.
 *
 * The repository holds the shape. It never holds the instance. Real household
 * data lives in `data/family.json`, outside the tree and gitignored, and the
 * committed demo dataset stands in when that file is absent.
 *
 * This is what the app ran on before the database, and it stays for local work:
 * one machine, one disk, no connection to configure and a dataset somebody can
 * open in an editor. On Vercel it cannot work at all, because the bundle is
 * read-only and `/tmp` evaporates, which is what `lib/store/postgres.ts` is for.
 *
 * The synchronous functions here are exported on purpose. They are the whole
 * file contract in one place, they are what the tests exercise directly, and
 * `scripts/import-family.ts` reads through them rather than parsing the file a
 * second time somewhere else.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAvailabilityProvider } from '../availability';
import {
  demoAvailability,
  households,
  interests,
  people,
  services,
  subscriptions,
  titles,
} from '../demo-data';
import {
  parseFamilyFile,
  withSubscriptionStatus,
  writeFamilyFile,
  type SubscriptionStatusChange,
} from '../family-file';
import {
  appendRequest,
  readQueue,
  readResults,
  PAUSE_QUEUE_PATH,
  PAUSE_RESULTS_PATH,
  type PauseRequest,
} from '../pause-queue';
import type { Subscription } from '../types';
import {
  DEFAULT_COUNTRY,
  type CatalogStore,
  type LoadedCatalog,
  type PauseSnapshot,
  type StatusWriteResult,
} from './types';

/** The private file. Gitignored, and the only place real data may sit on disk. */
export const FAMILY_DATA_PATH = join(process.cwd(), 'data', 'family.json');

/**
 * Load the catalogue from a file and say where it came from.
 *
 * Three outcomes, and only three. No private file gives demo data. A private
 * file that checks out gives real data. A private file that does not throws,
 * and never degrades to demo, because a reader who cannot tell the two apart
 * will eventually publish the wrong one.
 */
export function loadCatalogFromFile(path: string = FAMILY_DATA_PATH): LoadedCatalog {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return demoCatalog();
    // Present but unreadable - a permissions problem or a directory in its place.
    // Still not a reason to pretend the demo dataset is what was asked for.
    throw e;
  }

  const family = parseFamilyFile(text, path);
  return {
    source: 'private',
    path,
    catalog: {
      households: family.households,
      people: family.people,
      services: family.services,
      subscriptions: family.subscriptions,
      titles: family.titles,
      interests: family.interests,
      availability: new MockAvailabilityProvider(family.availability),
      country: family.country,
    },
  };
}

/** The fixture dataset, compiled into the bundle and identical on every backend. */
export function demoCatalog(): LoadedCatalog {
  return {
    source: 'demo',
    path: null,
    catalog: {
      households,
      people,
      services,
      subscriptions,
      titles,
      interests,
      availability: new MockAvailabilityProvider(demoAvailability),
      country: DEFAULT_COUNTRY,
    },
  };
}

/* --------------------------------------------------------------------------
 * Writing back.
 *
 * The same rule that governs reading governs writing, and in the same place.
 * Only the private file is a real store. The demo dataset is a fixture compiled
 * into the bundle, and a toggle pressed against it must never conjure a
 * `data/family.json` - a file that appears by accident is a file nobody can tell
 * apart from real household data later.
 * ----------------------------------------------------------------------- */

/**
 * Pause or resume one subscription, and say whether it survived the request.
 *
 * On private data the whole file is re-checked and rewritten atomically, so a
 * refusal leaves the previous file exactly as it was. On demo data nothing is
 * written and `persisted` is false, which the screen states rather than hides.
 */
export function setSubscriptionStatusInFile(
  change: SubscriptionStatusChange,
  path: string = FAMILY_DATA_PATH,
): StatusWriteResult {
  const loaded = loadCatalogFromFile(path);

  if (loaded.source === 'demo') {
    const sub = loaded.catalog.subscriptions.find((s) => s.id === change.subscriptionId);
    if (!sub) throw new Error(`No subscription "${change.subscriptionId}" in the demo dataset.`);
    return { source: 'demo', persisted: false, subscription: applyToRow(sub, change) };
  }

  const file = parseFamilyFile(readFileSync(path, 'utf8'), path);
  const next = withSubscriptionStatus(file, change);
  writeFamilyFile(path, next);
  return {
    source: 'private',
    persisted: true,
    subscription: next.subscriptions.find((s) => s.id === change.subscriptionId)!,
  };
}

/** The in-memory equivalent, for the demo dataset the app may not write to. */
export function applyToRow(sub: Subscription, change: SubscriptionStatusChange): Subscription {
  const { status: _s, pausedOn: _p, resumeBy: _r, ...rest } = sub;
  if (change.status === 'active') return { ...rest, status: 'active' };
  const paused: Subscription = { ...rest, status: 'paused', pausedOn: change.pausedOn };
  if (change.resumeBy !== undefined) paused.resumeBy = change.resumeBy;
  return paused;
}

/* -- The store ------------------------------------------------------------- */

/**
 * The file store, behind the seam.
 *
 * Its pause queue is the file Cowork reads, so writing a request *is* handing
 * it off - there is no machine in between and nothing to wait for. That is why
 * every request it reports carries a `handedOffAt`, and it is exactly the
 * difference the hosted app cannot claim.
 */
export class FileCatalogStore implements CatalogStore {
  readonly name = 'data/family.json';

  constructor(
    private readonly familyPath: string = FAMILY_DATA_PATH,
    private readonly queuePath: string = PAUSE_QUEUE_PATH,
    private readonly resultsPath: string = PAUSE_RESULTS_PATH,
  ) {}

  async load(): Promise<LoadedCatalog> {
    return loadCatalogFromFile(this.familyPath);
  }

  async setSubscriptionStatus(change: SubscriptionStatusChange): Promise<StatusWriteResult> {
    return setSubscriptionStatusInFile(change, this.familyPath);
  }

  async queuePauseRequest(request: PauseRequest): Promise<void> {
    appendRequest(request, this.queuePath);
  }

  async pauseSnapshot(): Promise<PauseSnapshot> {
    // A malformed queue must not take the whole screen down. The results reader
    // already refuses to throw for the same reason.
    let queue;
    try {
      queue = readQueue(this.queuePath);
    } catch {
      queue = { version: 1, writtenAt: new Date(0).toISOString(), requests: [] };
    }
    return {
      requests: queue.requests.map((request) => ({ request, handedOffAt: queue.writtenAt })),
      results: readResults(this.resultsPath),
    };
  }
}
