/**
 * Writing a file without being able to lose it.
 *
 * Every file this app writes holds state a family cannot reconstruct: what they
 * pay, what they asked to stop. Truncating one in place means a crash or a full
 * disk leaves a valid-looking file with half the data in it, and nothing in the
 * app can tell that apart from a family who cancelled everything.
 *
 * So: write a temp file in the same directory, flush it, rename it over the
 * target. Rename within a directory is atomic on every filesystem this runs on,
 * which makes the swap all-or-nothing. Same directory matters - a rename across
 * devices is a copy, and a copy is exactly the thing being avoided.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Write `text` to `path`, atomically. Creates the directory if it is missing. */
export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });

  // The pid and the clock keep two concurrent writers off each other's temp file.
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle: number | undefined;
  try {
    handle = openSync(temp, 'wx');
    writeFileSync(handle, text, 'utf8');
    // Durable before the swap. Without this the rename can reach the disk ahead
    // of the bytes it is renaming, and a power cut lands an empty file.
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    renameSync(temp, path);
  } catch (e) {
    if (handle !== undefined) closeSync(handle);
    try {
      unlinkSync(temp);
    } catch {
      // The temp file may never have been created. The original error is the one
      // worth surfacing, so a failed cleanup must not replace it.
    }
    throw e;
  }
}

/** The same guarantee for JSON, with the trailing newline a text file wants. */
export function writeJsonFile(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
