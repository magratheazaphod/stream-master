/**
 * One assertion, and it is the one worth isolating: the password comparison
 * goes through `timingSafeEqual` and never through `===`.
 *
 * Wall-clock timing assertions are flaky, so this proves the property by
 * construction instead - mock `node:crypto` and watch the call. It lives in its
 * own file because `vi.mock` is hoisted to the top of the module and would
 * otherwise apply to every other test here.
 */

import { describe, expect, it, vi } from 'vitest';

const seen = vi.fn();

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      seen(a, b);
      return actual.timingSafeEqual(a, b);
    },
  };
});

const { hashPassword, verifyPassword } = await import('./password');

describe('the password comparison', () => {
  it('runs through timingSafeEqual on a match', async () => {
    const stored = await hashPassword('constant time please');
    seen.mockClear();
    await expect(verifyPassword('constant time please', stored)).resolves.toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    const [a, b] = seen.mock.calls[0] as [Buffer, Buffer];
    expect(a.byteLength).toBe(b.byteLength);
  });

  it('runs through timingSafeEqual on a miss too', async () => {
    // A wrong password must cost the same comparison, not an early exit.
    const stored = await hashPassword('constant time please');
    seen.mockClear();
    await expect(verifyPassword('constant time pleasf', stored)).resolves.toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
