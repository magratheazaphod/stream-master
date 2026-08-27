/**
 * The one place that opens a connection, and the only file in `lib/` that knows
 * a password exists.
 *
 * The client is `postgres`, not an ORM and not `supabase-js`. The schema is
 * ours, every migration in `supabase/migrations/` is hand-written, and the
 * queries this app runs are joins across tables it defined - so PostgREST would
 * put a second query language between the app and SQL it already owns, and an
 * ORM would put a third model between the app and a schema whose constraints
 * are the design. `postgres` gives tagged-template parameterisation, honest
 * SQL and no schema of its own to keep in step.
 *
 * Two operational facts this file exists to encode:
 *
 *   1. Vercel's `POSTGRES_URL` points at Supabase's pooler on 6543, which is
 *      transaction mode. Prepared statements do not survive it, so `prepare`
 *      is off. Turning it on brings back "prepared statement already exists"
 *      under load and only under load.
 *   2. One client per process, reused. A serverless function that opens a
 *      connection per request exhausts the pool the free plan gives us long
 *      before it exhausts anything else.
 */

import postgres, { type Sql } from 'postgres';

/**
 * The connection string, or null when this process has none.
 *
 * Null is a legitimate answer and the whole reason the seam exists: a laptop
 * with no database configured runs on files. `STREAM_MASTER_STORE=file` forces
 * that even where a connection is configured, which is how local work happens
 * against `data/family.json` without unsetting anything.
 */
export function connectionString(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.STREAM_MASTER_STORE === 'file') return null;
  return env.POSTGRES_URL || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || null;
}

/** True when this process can reach Postgres. Never reveals what it reaches. */
export function hasDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  return connectionString(env) !== null;
}

/**
 * How to describe the database to a person. Host and database name only.
 *
 * This string reaches error messages and the masthead, so it carries no user,
 * no password and no query parameters. A connection string in a log line is a
 * credential in a log line.
 */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
}

let client: Sql | null = null;

/** The shared client. Opened on first use, reused for the life of the process. */
export function db(): Sql {
  if (client) return client;
  const url = connectionString();
  if (!url) {
    throw new Error(
      'No database is configured. Set POSTGRES_URL, or set STREAM_MASTER_STORE=file to work from data/family.json.',
    );
  }
  client = connect(url);
  return client;
}

/**
 * A client for a given URL. Used by the scripts, which connect once, do one job
 * and close, and must not inherit the app's long-lived pool.
 */
export function connect(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    // Transaction-mode pooling. See the note at the head of this file.
    prepare: false,
    max: options.max ?? 5,
    // Supabase terminates idle connections; reconnecting is cheaper than
    // holding one open across a function's cold gaps.
    idle_timeout: 20,
    connect_timeout: 15,
    // Dates come back as strings. Every date in this domain is an ISO day the
    // app compares and renders as text, and letting the driver build a Date
    // would shift a renewal across a day boundary in the wrong timezone.
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (v: string) => v,
        parse: (v: string) => v,
      },
    },
    onnotice: () => {},
  });
}
