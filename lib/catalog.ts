/**
 * Where the app gets its data, and the only place that decides which dataset it
 * is running on.
 *
 * The repository holds the shape. It never holds the instance. Real household
 * data lives in `data/family.json`, outside the tree and gitignored, and the
 * committed demo dataset stands in when that file is absent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAvailabilityProvider } from './availability';
import {
  demoAvailability,
  households,
  interests,
  people,
  services,
  subscriptions,
  titles,
} from './demo-data';
import {
  parseFamilyFile,
  withSubscriptionStatus,
  writeFamilyFile,
  type SubscriptionStatusChange,
} from './family-file';
import type { Catalog } from './domain';
import type { CountryCode, Subscription } from './types';

/**
 * The family is US-only today. Named here rather than assumed anywhere, so the
 * day a household moves the change lands in one place.
 */
export const DEFAULT_COUNTRY: CountryCode = 'US';

/** The private file. Gitignored, and the only place real data may sit. */
export const FAMILY_DATA_PATH = join(process.cwd(), 'data', 'family.json');

/** Which dataset the app is running on. Rendered in the masthead on every page. */
export type DatasetSource = 'demo' | 'private';

export interface LoadedCatalog {
  source: DatasetSource;
  /** Where the private data came from, for the error message and for the UI. */
  path: string | null;
  catalog: Catalog;
}

/**
 * Load the catalog and say where it came from.
 *
 * Three outcomes, and only three. No private file gives demo data. A private
 * file that checks out gives real data. A private file that does not throws,
 * and never degrades to demo, because a reader who cannot tell the two apart
 * will eventually publish the wrong one.
 */
export function loadCatalog(path: string = FAMILY_DATA_PATH): LoadedCatalog {
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

function demoCatalog(): LoadedCatalog {
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

/**
 * The single place the app reads its data. Swapping the private file for a
 * database means changing `loadCatalog` and nothing else.
 */
export function getCatalog(): Catalog {
  return loadCatalog().catalog;
}

/** The provenance alone, for the indicator every page carries. */
export function getDatasetSource(): DatasetSource {
  return loadCatalog().source;
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

/** What a toggle actually achieved, in the terms the screen has to report. */
export interface StatusWriteResult {
  source: DatasetSource;
  /** False on demo data. The change is real for this session and nothing more. */
  persisted: boolean;
  subscription: Subscription;
}

/**
 * Pause or resume one subscription, and say whether it survived the request.
 *
 * On private data the whole file is re-checked and rewritten atomically, so a
 * refusal leaves the previous file exactly as it was. On demo data nothing is
 * written and `persisted` is false, which the screen states rather than hides.
 */
export function setSubscriptionStatus(
  change: SubscriptionStatusChange,
  path: string = FAMILY_DATA_PATH,
): StatusWriteResult {
  const loaded = loadCatalog(path);

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
function applyToRow(sub: Subscription, change: SubscriptionStatusChange): Subscription {
  const { status: _s, pausedOn: _p, resumeBy: _r, ...rest } = sub;
  if (change.status === 'active') return { ...rest, status: 'active' };
  const paused: Subscription = { ...rest, status: 'paused', pausedOn: change.pausedOn };
  if (change.resumeBy !== undefined) paused.resumeBy = change.resumeBy;
  return paused;
}
