import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

const T0 = 1_000_000;

describe('RateLimiter', () => {
  it('allows attempts up to the limit and refuses the next', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.attempt('ip', T0).allowed).toBe(true);
    expect(limiter.attempt('ip', T0).allowed).toBe(true);
    expect(limiter.attempt('ip', T0).allowed).toBe(true);
    const refused = limiter.attempt('ip', T0);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it('counts each client separately', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.attempt('a', T0).allowed).toBe(true);
    expect(limiter.attempt('b', T0).allowed).toBe(true);
    expect(limiter.attempt('a', T0).allowed).toBe(false);
  });

  it('opens a fresh window once the old one lapses', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.attempt('ip', T0).allowed).toBe(true);
    expect(limiter.attempt('ip', T0 + 59_999).allowed).toBe(false);
    expect(limiter.attempt('ip', T0 + 60_000).allowed).toBe(true);
  });

  // A correct password clears the count, so a household that fumbles the
  // password twice is not one typo from locking itself out for a quarter hour.
  it('forgets a client on reset', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.attempt('ip', T0);
    limiter.attempt('ip', T0);
    expect(limiter.attempt('ip', T0).allowed).toBe(false);
    limiter.reset('ip');
    expect(limiter.attempt('ip', T0).allowed).toBe(true);
  });

  it('shrinks the retry window as the clock runs down', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.attempt('ip', T0);
    expect(limiter.attempt('ip', T0 + 30_000).retryAfterSeconds).toBe(30);
  });
});
