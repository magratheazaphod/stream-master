/**
 * Where the app gets its data, and the only place that decides which dataset it
 * is running on.
 *
 * There are two stores now, a file and a Postgres database, and this module is
 * the door in front of both. It knows which one it has - `lib/store/` decides
 * that - and it knows nothing about how either works. No path, no table and no
 * query appears above this line.
 *
 * What does not change with the backend is the rule. Three outcomes, and only
 * three: no private data gives the demo dataset, private data that checks out
 * gives the real one, and private data that does not throws and never degrades
 * to demo. It is a safety property rather than a convenience, and it matters
 * more with two stores than it did with one, because there are now two ways for
 * a reader to lose track of which family they are looking at.
 */

import { getStore } from './store';
import type { SubscriptionStatusChange } from './family-file';
import type { Catalog } from './domain';

export { DEFAULT_COUNTRY } from './store/types';
export { FAMILY_DATA_PATH, loadCatalogFromFile } from './store/file';
export type { DatasetSource, LoadedCatalog, StatusWriteResult } from './store/types';

/**
 * Load the catalogue and say where it came from.
 *
 * The synchronous file reader it replaced is still exported as
 * `loadCatalogFromFile`, because the file's own behaviour is worth testing on
 * its own terms. This is what the pages call.
 */
export function loadCatalog() {
  return getStore().load();
}

/** The single place the app reads its data. */
export async function getCatalog(): Promise<Catalog> {
  return (await loadCatalog()).catalog;
}

/** The provenance alone, for the indicator every page carries. */
export async function getDatasetSource() {
  return (await loadCatalog()).source;
}

/**
 * Pause or resume one subscription, and say whether it survived the request.
 *
 * Both stores refuse the same changes and both leave the previous state intact
 * when they refuse. Neither writes anything against the demo dataset: it is a
 * fixture, and a toggle pressed on it must never conjure a household row or a
 * `data/family.json` that nobody can tell apart from real data later.
 */
export function setSubscriptionStatus(change: SubscriptionStatusChange) {
  return getStore().setSubscriptionStatus(change);
}
