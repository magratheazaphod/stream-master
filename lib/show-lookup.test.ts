/**
 * The lookup's three interesting decisions: which provider name maps to which
 * service, whether the family already has it, and what an absent answer means.
 *
 * The last one carries the weight. TMDB answering with nothing is a fact about
 * TMDB. Rendered as "unavailable" it becomes the app denying a show exists, and
 * a family plans around that.
 */

import { describe, expect, it } from 'vitest';
import { MockAvailabilityProvider } from './availability';
import type { Catalog } from './domain';
import {
  isLiveTvBundle,
  lookupResolved,
  lookupShow,
  matchService,
  normalizeProviderName,
  suggestTitles,
} from './show-lookup';
import type { TmdbClient } from './tmdb/client';
import type { Service, Subscription } from './types';

const services: Service[] = [
  { id: 's-netflix', name: 'Netflix', monthlyPrice: 17.99, sharingPolicy: 'household-only' },
  { id: 's-max', name: 'Max', monthlyPrice: 16.99, sharingPolicy: 'household-only' },
  { id: 's-paramount', name: 'Paramount+', monthlyPrice: 7.99, sharingPolicy: 'household-only' },
];

const catalogWith = (subscriptions: Subscription[]): Catalog => ({
  households: [
    { id: 'h1', name: 'Northgate', location: 'Northgate, CA' },
    { id: 'h2', name: 'Riverbend', location: 'Riverbend, IL' },
  ],
  people: [{ id: 'p1', name: 'Avery', householdId: 'h1' }],
  services,
  subscriptions,
  titles: [],
  interests: [],
  availability: new MockAvailabilityProvider({}),
  country: 'US',
});

const sub = (over: Partial<Subscription>): Subscription => ({
  id: 'sub1',
  serviceId: 's-netflix',
  householdId: 'h1',
  payerId: 'p1',
  monthlyCost: 17.99,
  billingCycle: 'monthly',
  renewsOn: '2026-09-01',
  status: 'active',
  ...over,
});

/** A TMDB stand-in. Only the four calls the lookup makes are implemented. */
function fakeClient(over: Partial<Record<string, unknown>>): TmdbClient {
  const notFound = async () => ({ kind: 'not_found' as const });
  const empty = async () => ({ kind: 'ok' as const, data: { page: 1, results: [], total_pages: 0, total_results: 0 } });
  return {
    searchTv: over.searchTv ?? empty,
    searchMovie: over.searchMovie ?? empty,
    getTvWatchProviders: over.getTvWatchProviders ?? notFound,
    getMovieWatchProviders: over.getMovieWatchProviders ?? notFound,
  } as unknown as TmdbClient;
}

const tvHit = (name = 'Severance') =>
  async () => ({
    kind: 'ok' as const,
    data: {
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [{ id: 95396, name, first_air_date: '2022-02-18', popularity: 90 }],
    },
  });

const providers = (slice: Record<string, unknown>) =>
  async () => ({ kind: 'ok' as const, data: { id: 1, results: { US: { link: 'https://justwatch.test/x', ...slice } } } });

describe('collapsing provider variants', () => {
  it.each([
    ['Netflix', 'Netflix Standard with Ads'],
    ['Paramount+', 'Paramount Plus Premium'],
    ['Paramount+', 'Paramount+ Amazon Channel'],
  ])('reads %s and %s as one subscription decision', (a, b) => {
    expect(normalizeProviderName(a)).toBe(normalizeProviderName(b));
  });

  it('matches a TMDB provider name onto the family service', () => {
    expect(matchService(services, 'Netflix Standard with Ads')?.id).toBe('s-netflix');
  });

  // TMDB still ships HBO's pre-rename name, and the family calls it Max.
  it('follows a recorded alias where TMDB and the family use different names', () => {
    expect(matchService(services, 'HBO Max')?.id).toBe('s-max');
    expect(matchService(services, 'HBO Max Amazon Channel')?.id).toBe('s-max');
  });

  it('knows a live-TV bundle from a streaming subscription', () => {
    expect(isLiveTvBundle('YouTube TV')).toBe(true);
    expect(isLiveTvBundle('Netflix')).toBe(false);
  });

  it('returns nothing for a provider the family holds no record of', () => {
    expect(matchService(services, 'Shudder')).toBeUndefined();
  });
});

describe('answering a lookup', () => {
  it('says so when nothing matches the typed text', async () => {
    const answer = await lookupShow({ client: fakeClient({}), catalog: catalogWith([]) }, 'zzzz');
    expect(answer.status).toBe('no-match');
  });

  // A 404 from the provider endpoint is TMDB telling us about itself.
  it('renders an absent provider record as unknown, never unavailable', async () => {
    const client = fakeClient({ searchTv: tvHit() });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('unknown');
  });

  it('renders a US-shaped gap as unknown too', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: async () => ({ kind: 'ok' as const, data: { id: 1, results: { GB: { link: 'x' } } } }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('unknown');
  });

  it('claims unavailable only when TMDB answered with no provider at all', async () => {
    const client = fakeClient({ searchTv: tvHit(), getTvWatchProviders: providers({}) });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('unavailable');
  });

  it('says the family has it when an active subscription carries it', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([sub({})]) }, 'Severance');
    expect(answer.status).toBe('have-it');
    if (answer.status !== 'have-it') return;
    expect(answer.heldBy[0].service.id).toBe('s-netflix');
    expect(answer.heldBy[0].households[0].name).toBe('Northgate');
  });

  // Paused buys nobody access today. Treating it as held is how the app tells a
  // family they can watch something they cannot.
  it('does not count a paused subscription as having it', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    });
    const catalog = catalogWith([sub({ status: 'paused', pausedOn: '2026-06-01' })]);
    const answer = await lookupShow({ client, catalog }, 'Severance');
    expect(answer.status).toBe('need-it');
    if (answer.status !== 'need-it') return;
    expect(answer.paths[0].resumes).toBe('sub1');
    expect(answer.paths[0].monthlyCost).toBe(17.99);
  });

  it('ranks the cheapest way in first', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({
        flatrate: [
          { provider_id: 8, provider_name: 'Netflix' },
          { provider_id: 531, provider_name: 'Paramount Plus' },
        ],
      }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('need-it');
    if (answer.status !== 'need-it') return;
    expect(answer.paths.map((p) => p.service.id)).toEqual(['s-paramount', 's-netflix']);
  });

  it('names a carrying provider the family has no price for, without pricing it', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({ flatrate: [{ provider_id: 99, provider_name: 'Shudder' }] }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('need-it');
    if (answer.status !== 'need-it') return;
    expect(answer.paths).toEqual([]);
    expect(answer.unpriced).toEqual(['Shudder']);
  });

  // Half the raw provider splits in the coverage spike were live-TV bundles.
  // Offering one as the way to watch a show is noise dressed as an answer.
  it('leaves live-TV bundles out of the answer entirely', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({
        flatrate: [
          { provider_id: 1, provider_name: 'YouTube TV' },
          { provider_id: 8, provider_name: 'Netflix' },
        ],
      }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('need-it');
    if (answer.status !== 'need-it') return;
    expect(answer.paths.map((p) => p.service.id)).toEqual(['s-netflix']);
    expect(answer.unpriced).toEqual([]);
  });

  it('keeps rent and buy apart from a subscription answer', async () => {
    const client = fakeClient({
      searchTv: tvHit(),
      getTvWatchProviders: providers({ buy: [{ provider_id: 2, provider_name: 'Apple TV' }] }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('need-it');
    if (answer.status !== 'need-it') return;
    expect(answer.rentOrBuyOn).toEqual(['Apple TV']);
    expect(answer.paths).toEqual([]);
  });

  it('prefers an exact title match over a more popular near miss', async () => {
    const client = fakeClient({
      searchTv: async () => ({
        kind: 'ok' as const,
        data: {
          page: 1,
          total_pages: 1,
          total_results: 2,
          results: [
            { id: 2, name: 'Andor: Behind the Scenes', first_air_date: '2023-01-01', popularity: 500 },
            { id: 1, name: 'Andor', first_air_date: '2022-09-21', popularity: 60 },
          ],
        },
      }),
      getTvWatchProviders: providers({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    });
    const answer = await lookupShow({ client, catalog: catalogWith([sub({})]) }, 'Andor');
    expect(answer.status).toBe('have-it');
    if (answer.status !== 'have-it') return;
    expect(answer.title.tmdbId).toBe(1);
  });

  it('reports unknown when both searches fail rather than guessing', async () => {
    const failing = async () => ({ kind: 'error' as const, message: 'network' });
    const client = fakeClient({ searchTv: failing, searchMovie: failing });
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'Severance');
    expect(answer.status).toBe('unknown');
  });
});

/**
 * The suggestion list. Its job is to make an ambiguous half-typed string legible
 * before somebody commits to an answer, so what matters is that it offers the
 * near-misses, ranks the same way the answer does, and never turns a source
 * failure into a claim about the title.
 */
describe('suggesting titles', () => {
  const manyTv = async () => ({
    kind: 'ok' as const,
    data: {
      page: 1,
      total_pages: 1,
      total_results: 3,
      results: [
        { id: 2, name: 'NCIS: Los Angeles', first_air_date: '2009-09-22', popularity: 300 },
        { id: 1, name: 'NCIS', first_air_date: '2003-09-23', popularity: 120 },
        { id: 3, name: 'NCIS: Hawai\u2019i', first_air_date: '2021-09-20', popularity: 80 },
      ],
    },
  });

  it('keeps the near-misses rather than collapsing to one answer', async () => {
    const found = await suggestTitles(fakeClient({ searchTv: manyTv }), 'NCIS');
    expect(found).not.toBe('error');
    if (found === 'error') return;
    expect(found).toHaveLength(3);
    expect(found.map((t) => t.name)).toContain('NCIS: Los Angeles');
  });

  // The exact match leads even though a spin-off is three times as popular.
  it('ranks an exact title above a more popular near-miss', async () => {
    const found = await suggestTitles(fakeClient({ searchTv: manyTv }), 'NCIS');
    if (found === 'error') return;
    expect(found[0].name).toBe('NCIS');
  });

  // One ranking rule, or the list would offer a top row that Ask disagrees with.
  it('leads with the same title the plain lookup would answer about', async () => {
    const client = fakeClient({ searchTv: manyTv });
    const found = await suggestTitles(client, 'NCIS');
    const answer = await lookupShow({ client, catalog: catalogWith([]) }, 'NCIS');
    if (found === 'error') return;
    expect(answer.status).not.toBe('no-match');
    if (answer.status === 'no-match') return;
    expect(answer.title?.tmdbId).toBe(found[0].tmdbId);
  });

  it('carries the year and the kind, which is what tells two titles apart', async () => {
    const found = await suggestTitles(fakeClient({ searchTv: tvHit() }), 'Severance');
    if (found === 'error') return;
    expect(found[0]).toMatchObject({ name: 'Severance', year: 2022, kind: 'series' });
  });

  it('reports a dead search as an error, never as an empty list', async () => {
    const dead = async () => ({ kind: 'error' as const, reason: 'network' });
    const found = await suggestTitles(fakeClient({ searchTv: dead, searchMovie: dead }), 'Severance');
    expect(found).toBe('error');
  });

  it('returns nothing for a query too short to mean anything', async () => {
    const found = await suggestTitles(fakeClient({ searchTv: manyTv }), '');
    if (found === 'error') return;
    expect(found).toEqual([]);
  });
});

/**
 * Picking a suggestion answers about the title picked. Re-resolving the text
 * would quietly swap it for the popular one and say nothing.
 */
describe('answering about a picked title', () => {
  it('never re-runs the search, so the choice survives', async () => {
    let searched = 0;
    const client = fakeClient({
      searchTv: async () => {
        searched += 1;
        return { kind: 'ok' as const, data: { page: 1, results: [], total_pages: 0, total_results: 0 } };
      },
      getTvWatchProviders: providers({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    });
    const answer = await lookupResolved(
      { client, catalog: catalogWith([sub({})]) },
      { tmdbId: 4242, name: 'NCIS: Los Angeles', year: 2009, kind: 'series' },
    );
    expect(searched).toBe(0);
    expect(answer.status).toBe('have-it');
    if (answer.status !== 'have-it') return;
    expect(answer.title.tmdbId).toBe(4242);
    expect(answer.title.name).toBe('NCIS: Los Angeles');
  });

  it('keeps unknown meaning unknown for a picked title too', async () => {
    const answer = await lookupResolved(
      { client: fakeClient({}), catalog: catalogWith([]) },
      { tmdbId: 4242, name: 'NCIS: Los Angeles', kind: 'series' },
    );
    expect(answer.status).toBe('unknown');
  });
});
