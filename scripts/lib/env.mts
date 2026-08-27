/**
 * Reading `.env.local` from a script.
 *
 * Next.js loads this file for the app. Nothing loads it for a script, which is
 * how `npm run db:seed` came to pipe into `psql "$DATABASE_URL"` against a
 * variable nobody sets. Every script here reads the same file the app does, so
 * there is one place a connection is configured and no second one to forget.
 *
 * Nothing in this module prints a value. A connection string in a log line is a
 * credential in a log line, and these scripts run in a terminal somebody scrolls
 * back through.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Merge `.env.local` into `process.env`, leaving anything already set alone.
 *
 * A variable exported in the shell wins, which is what lets one command run
 * against the local stack without editing the file.
 */
export function loadEnvLocal(path: string = join(repoRoot, '.env.local')): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'");
    if (quoted) value = value.slice(1, -1);

    // `scripts/escape-env.mjs` backslash-escapes the dollars in the password
    // digest, because a .env file expands `$NAME` and the gate then refuses
    // every request. Undo it here so a script sees the value the app sees.
    process.env[key] = value.replace(/\\\$/g, '$');
  }
}

/**
 * The connection string, or a clear stop.
 *
 * Refusing loudly rather than falling through to a default: a script that
 * silently connects to the wrong database is worse than one that will not run.
 */
export function requireConnectionString(): string {
  // The shell is read first and in full. Reading `.env.local` first and then
  // preferring the non-pooling variable out of the merged result is how a
  // deliberate `POSTGRES_URL=...local... npm run db:seed` ends up writing to
  // the hosted database instead: the exported variable is there, and a
  // different one from the file quietly outranks it. Any variable set in the
  // shell wins outright, and only then does the file's order matter.
  const fromShell =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (fromShell) return fromShell;

  loadEnvLocal();
  // Session mode by preference. The pooler on 6543 is transaction mode, which
  // scripts that run DDL or one long transaction have no business using.
  const url =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No database configured. Set POSTGRES_URL in .env.local, or export it for one command:\n' +
        "  POSTGRES_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' npm run <script>",
    );
  }
  return url;
}

/** Host and database only, for the one line a script is allowed to print. */
export function describe(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
}
