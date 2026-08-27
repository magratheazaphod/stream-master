/**
 * Which store this process gets, and the one decision behind the seam.
 *
 * A connection means Postgres. No connection means the file. Nothing else
 * chooses, and nothing above this line asks - `lib/catalog.ts` takes whatever
 * comes back and the pages take whatever it hands them.
 *
 * The rule is deliberately about configuration and not about where the process
 * runs. Vercel has a connection and gets Postgres. A laptop with `.env.local`
 * pulled has one too, and gets Postgres against the same hosted database, which
 * is what makes local work representative. `STREAM_MASTER_STORE=file` is the
 * way back to `data/family.json`, and it exists because a file somebody can
 * open in an editor is still the fastest way to try a shape out.
 */

import { FileCatalogStore } from './file';
import { PostgresCatalogStore } from './postgres';
import { hasDatabase } from './db';
import type { CatalogStore } from './types';

let store: CatalogStore | null = null;

/** The store this process reads and writes. One per process, chosen once. */
export function getStore(): CatalogStore {
  if (!store) store = hasDatabase() ? new PostgresCatalogStore() : new FileCatalogStore();
  return store;
}

/** Drop the memoised store. For tests, which change the environment underneath. */
export function resetStore(): void {
  store = null;
}

export { FileCatalogStore } from './file';
export { PostgresCatalogStore } from './postgres';
export * from './types';
