/**
 * The password check, on the Node runtime.
 *
 * The environment holds a scrypt digest, not the password. That costs nothing
 * to implement, Node ships scrypt in the standard library, and it means the
 * value sitting in the Vercel dashboard and in Jesse's shell history is not the
 * thing that opens the app. Whoever reads the dashboard still cannot sign in.
 *
 * Format: `scrypt$N$r$p$saltBase64$keyBase64`. The parameters travel with the
 * digest so raising the cost later does not invalidate the hashes already set.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Roughly 100ms on a laptop, which is the right price for a family sign-in. */
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt refuses to run unless maxmem clears 128 * N * r. Give it headroom. */
const maxmemFor = (N: number, r: number) => Math.max(32 * 1024 * 1024, 256 * N * r);

/** Hash a password into the string that goes in the environment variable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

/** Parse a stored digest. Returns null rather than throwing: a malformed hash
 *  is an operator error, and the caller's answer to it is the same "no". */
export function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nText, rText, pText, saltText, keyText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || r < 1 || p < 1) return null;
  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(saltText, 'base64');
    key = Buffer.from(keyText, 'base64');
  } catch {
    return null;
  }
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

/**
 * Does `password` match the stored digest?
 *
 * The comparison is `timingSafeEqual` on two buffers of identical length, which
 * is the only comparison in this file. `===` on a digest leaks the length of
 * the matching prefix, and a leak like that is measurable across a network on
 * enough samples. There is no reason to take the risk when the fix is one call.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(password, parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: maxmemFor(parsed.N, parsed.r),
    });
  } catch {
    return false;
  }
  // Lengths already agree by construction, but timingSafeEqual throws on a
  // mismatch, so guard rather than let a bad hash become a 500.
  if (derived.length !== parsed.key.length) return false;
  return timingSafeEqual(derived, parsed.key);
}
