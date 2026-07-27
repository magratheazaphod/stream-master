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
import { parseFamilyFile } from './family-file';
import type { Catalog } from './domain';
import type { CountryCode } from './types';

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
