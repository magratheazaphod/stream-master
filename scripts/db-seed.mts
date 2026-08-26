/**
 * Apply the provider seed. `npm run db:seed`.
 *
 * This replaced a shell pipeline into `psql "$DATABASE_URL"`, which failed for
 * a dull reason: nothing set `DATABASE_URL`, so psql read an empty string,
 * connected to whatever the local socket happened to be, and the seed either
 * failed or landed somewhere nobody asked for. The connection now comes from
 * `.env.local`, the same file the app reads, and `psql` is not required.
 *
 * The SQL itself is unchanged and still comes from `scripts/seed-providers.mjs`,
 * which `npm run db:seed:sql` prints for anyone who wants to read it first.
 */

import { providerSeedSql } from './seed-providers.mjs';
import { connect } from '../lib/store/db';
import { describe, requireConnectionString } from './lib/env.mjs';

const url = requireConnectionString();
// The app's own connector, so a script sees the same values the app does.
// Dates in particular: it keeps them as the ISO days they are, and a Date
// object here would put a timestamp in the queue file Cowork parses.
const sql = connect(url, { max: 1 });

try {
  console.log(`Seeding providers into ${describe(url)}`);
  // One call, and the generated SQL carries its own BEGIN and COMMIT. A seed
  // that half-applies leaves the canonical-provider pass pointing at rows the
  // first pass never wrote.
  await sql.unsafe(providerSeedSql());
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from providers`;
  console.log(`Done. ${count} providers.`);
} finally {
  await sql.end();
}
