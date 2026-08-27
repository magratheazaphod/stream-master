import { describe, expect, it } from 'vitest';
import { signSession, timingSafeEqualString, verifySession } from './session';

const SECRET = 'a-secret-long-enough-to-pass-the-config-check';
const HOUR = 60 * 60;
const now = new Date('2026-08-26T12:00:00Z');

describe('signSession and verifySession', () => {
  it('round-trips a fresh session', async () => {
    const token = await signSession(SECRET, 30 * 24 * HOUR, now);
    const payload = await verifySession(SECRET, token, now);
    expect(payload).not.toBeNull();
    expect(payload!.exp).toBe(Math.floor(now.getTime() / 1000) + 30 * 24 * HOUR);
  });

  it('carries no identity, because there is none to carry', async () => {
    const token = await signSession(SECRET, HOUR, now);
    const payload = await verifySession(SECRET, token, now);
    expect(Object.keys(payload!).sort()).toEqual(['exp', 'iat']);
  });

  it('refuses a token signed with a different secret', async () => {
    const token = await signSession(SECRET, HOUR, now);
    await expect(verifySession(`${SECRET}-rotated`, token, now)).resolves.toBeNull();
  });

  // The forgery that matters: rewrite the expiry and keep the old signature.
  it('refuses a tampered payload', async () => {
    const token = await signSession(SECRET, HOUR, now);
    const [version, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ iat: 0, exp: 4102444800 })).toString('base64url');
    await expect(verifySession(SECRET, `${version}.${forged}.${sig}`, now)).resolves.toBeNull();
  });

  it('refuses an expired session even when the signature is good', async () => {
    const token = await signSession(SECRET, HOUR, now);
    const later = new Date(now.getTime() + (HOUR + 1) * 1000);
    await expect(verifySession(SECRET, token, later)).resolves.toBeNull();
    await expect(verifySession(SECRET, token, now)).resolves.not.toBeNull();
  });

  it('refuses missing and malformed tokens without throwing', async () => {
    for (const bad of [undefined, '', 'nonsense', 'a.b', 'a.b.c.d', 'v2.abc.def']) {
      await expect(verifySession(SECRET, bad, now)).resolves.toBeNull();
    }
  });
});

describe('timingSafeEqualString', () => {
  it('agrees with equality on the answer', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'ab')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString('', 'a')).toBe(false);
  });

  it('scans the longer of the two, so a length mismatch is not an early exit', () => {
    // Not a timing assertion - just the property the loop bound encodes.
    expect(timingSafeEqualString('a', 'a'.repeat(1000))).toBe(false);
    expect(timingSafeEqualString('a'.repeat(1000), 'a')).toBe(false);
  });
});
