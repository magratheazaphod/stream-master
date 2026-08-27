/**
 * When a pause ends, and what the answer depends on.
 *
 * This lived in the toggle route, which made it untestable and put a policy
 * decision behind an HTTP handler. It is domain logic: the app owns the resume
 * date, and getting it wrong is how a household loses a show mid-season.
 */

import type { BillingStopsAt, PauseTerms, Subscription } from './types';

/**
 * How long a pause runs before the app asks for it back.
 *
 * The app owns this date rather than leaving it open, because a pause nobody
 * lifts is how a household loses a show mid-season, and that failure costs more
 * trust than the subscription costs money. A provider that sells a shorter
 * native pause wins: promising four months on a two-month pause is a promise the
 * provider will break on the family's behalf.
 */
export const DEFAULT_PAUSE_MONTHS = 3;

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * The day the pause clock starts, which is not always today.
 *
 * Hulu's pause begins at the next billing date: press the button and the
 * household keeps watching, and keeps paying, until then. Counting the ceiling
 * from today on a provider like that lands the resume date up to a full billing
 * period early, and the app then tells the family a subscription is back before
 * the provider will bring it back.
 *
 * A renewal date already in the past means the record is stale, and today is the
 * safer of the two wrong answers - it asks for the subscription back sooner
 * rather than later. Where `billingStopsAt` is absent nobody established the
 * answer, and today is the assumption the app made everywhere before this
 * existed. It is still an assumption, which is why the field is worth recording
 * on every walkthrough from here on.
 */
export function pauseStartsOn(
  renewsOn: string,
  billingStopsAt: BillingStopsAt | undefined,
  now: Date,
): Date {
  if (billingStopsAt !== 'next-billing-date') return now;
  const renews = new Date(`${renewsOn}T00:00:00.000Z`);
  return Number.isNaN(renews.getTime()) || renews <= now ? now : renews;
}

/** The ISO day the app will ask for this subscription back. */
export function resumeByFor(
  sub: Pick<Subscription, 'renewsOn'>,
  terms: PauseTerms | undefined,
  now: Date,
): string {
  const start = pauseStartsOn(sub.renewsOn, terms?.billingStopsAt, now);
  return isoDay(addMonths(start, terms?.maxPauseMonths ?? DEFAULT_PAUSE_MONTHS));
}
