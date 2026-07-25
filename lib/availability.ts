import type { AvailabilityProvider, Offer, TitleId } from './types';
import { mockOffers } from './mock-data';

/**
 * Fixture-backed availability. Ships today so the interface is real without an
 * API key or a vendor decision.
 */
export class MockAvailabilityProvider implements AvailabilityProvider {
  constructor(private readonly table: Record<string, Offer[]> = mockOffers) {}

  offersFor(titleId: TitleId): Offer[] {
    return this.table[titleId] ?? [];
  }
}

/**
 * The real implementations slot in here.
 *
 * TMDB returns which providers carry a title per region, split into flatrate,
 * rent and buy, but it does not return transactional prices. Every rent and buy
 * offer it produces will have `price` undefined, which the UI already handles.
 *
 * Watchmode returns prices. That is the entire reason to pay for it.
 */
export const availability: AvailabilityProvider = new MockAvailabilityProvider();
