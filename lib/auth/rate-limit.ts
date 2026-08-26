/**
 * A speed bump on the sign-in form.
 *
 * It is in-memory, and the honest description of what that buys is short: it
 * stops somebody pasting a wordlist into a loop against one server process. It
 * does not survive a redeploy, it does not span serverless instances, and on
 * Vercel a determined attacker gets a fresh budget every time a cold instance
 * comes up. The real defence is the entropy in the password, and `docs/deploy.md`
 * says so.
 *
 * A shared store - Vercel KV, Upstash, the Postgres this project is heading
 * towards anyway - is the upgrade. It is deliberately not a dependency today.
 */

/** Attempts allowed inside the window before the window starts refusing. */
export const MAX_ATTEMPTS = 8;

/** Fifteen minutes. Long enough to hurt a script, short enough to forgive a typo. */
export const WINDOW_MS = 15 * 60 * 1000;

interface Bucket {
  count: number;
  /** When the window opened. The whole bucket resets, not one attempt. */
  startedAt: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Sent as Retry-After when refusing. */
  retryAfterSeconds: number;
}

/**
 * One limiter, keyed by whatever the caller considers a client. Instances are
 * explicit so the tests do not have to reach into module state.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxAttempts: number = MAX_ATTEMPTS,
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  /** Record an attempt and say whether it is allowed. Call once per attempt. */
  attempt(key: string, now: number = Date.now()): RateLimitVerdict {
    this.evict(now);
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      this.buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, remaining: this.maxAttempts - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const elapsed = now - bucket.startedAt;
    const retryAfterSeconds = Math.ceil((this.windowMs - elapsed) / 1000);
    if (bucket.count > this.maxAttempts) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return {
      allowed: true,
      remaining: this.maxAttempts - bucket.count,
      retryAfterSeconds: 0,
    };
  }

  /** Forget a key. Called on a successful sign-in, so a correct password does
   *  not leave the household one typo from a lockout. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop expired buckets so a long-lived process does not grow without bound. */
  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
  }
}

/** The process-wide limiter the sign-in route uses. */
export const signInLimiter = new RateLimiter();
