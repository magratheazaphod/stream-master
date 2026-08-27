/**
 * The resume date, and the one fact that makes it hard.
 *
 * Hulu's pause begins at the next billing date. Counting from the day somebody
 * pressed the button lands the date up to a billing period early and has the app
 * promise a return the provider will not honour - the failure
 * `cowork/hulu-pause.md` was written to prevent.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PAUSE_MONTHS, pauseStartsOn, resumeByFor } from './pause-dates';
import type { PauseTerms } from './types';

const now = new Date('2026-08-27T12:00:00.000Z');

const terms = (over: Partial<PauseTerms> = {}): PauseTerms => ({
  method: 'native-pause',
  manageUrl: 'https://example.test/account',
  maxPauseMonths: 2,
  costs: [],
  verifiedOn: '2026-08-26',
  ...over,
});

describe('when the pause clock starts', () => {
  it('starts today when billing stops immediately', () => {
    expect(pauseStartsOn('2026-09-09', 'immediately', now)).toEqual(now);
  });

  // Absent is unknown, and unknown keeps the behaviour the app already had.
  it('starts today when nobody established the answer', () => {
    expect(pauseStartsOn('2026-09-09', undefined, now)).toEqual(now);
  });

  it('starts at the next billing date when the provider says so', () => {
    expect(pauseStartsOn('2026-09-09', 'next-billing-date', now).toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    );
  });

  // A stale renewal date must not push the resume date into the past.
  it('falls back to today when the recorded renewal has already passed', () => {
    expect(pauseStartsOn('2026-01-01', 'next-billing-date', now)).toEqual(now);
  });
});

describe('the resume date', () => {
  it('counts the ceiling from the next billing date, not from today', () => {
    const date = resumeByFor(
      { renewsOn: '2026-09-09' },
      terms({ billingStopsAt: 'next-billing-date' }),
      now,
    );
    expect(date).toBe('2026-11-09');
  });

  // The bug this file exists for: the same subscription, counted from today,
  // comes back on 27 October - thirteen days before Hulu will bring it back.
  it('is later than the naive answer for a next-billing-date provider', () => {
    const honest = resumeByFor(
      { renewsOn: '2026-09-09' },
      terms({ billingStopsAt: 'next-billing-date' }),
      now,
    );
    const naive = resumeByFor({ renewsOn: '2026-09-09' }, terms(), now);
    expect(naive).toBe('2026-10-27');
    expect(honest > naive).toBe(true);
  });

  it('falls back to the default ceiling when no terms are recorded', () => {
    const date = resumeByFor({ renewsOn: '2026-09-09' }, undefined, now);
    expect(date).toBe('2026-11-27');
    expect(DEFAULT_PAUSE_MONTHS).toBe(3);
  });
});
