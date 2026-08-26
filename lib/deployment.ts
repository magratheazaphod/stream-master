/**
 * Where this process is running, and what it is therefore allowed to promise.
 *
 * On Vercel the deployment bundle is read-only and the one writable directory,
 * `/tmp`, is per-instance and evaporates. Both of this app's stores are files:
 * `data/family.json` and `data/pause-queue.json`. Neither survives there.
 *
 * Fixing that is the database migration, which is separate work. What this
 * module exists to prevent is the failure in between: a family member presses
 * Pause, the write throws an EROFS deep inside `writeFileAtomic`, and the screen
 * shows either a stack trace or, worse, nothing at all. A button that silently
 * does nothing is the one outcome this product cannot afford, because the whole
 * proposition is that the app tells the truth about what it did.
 */

import type { Env } from './auth/config';

/** True when the filesystem this process writes to will not keep what it writes. */
export function isEphemeralFilesystem(env: Env = process.env): boolean {
  return env.VERCEL === '1';
}

/**
 * The sentence the screen shows instead of pretending. It names the cause and
 * the fix, because the family reading it cannot do anything about either and
 * deserves to know that rather than press the button again.
 */
export const EPHEMERAL_WRITE_MESSAGE =
  'This copy runs on Vercel, where the app cannot save anything to disk. Nothing was recorded and nothing was queued. Pausing works on a local copy until the database lands.';
