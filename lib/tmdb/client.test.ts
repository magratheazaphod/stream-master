import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TmdbClient } from './client';

import tvSearch from './__fixtures__/tv-search.json';
import movieSearch from './__fixtures__/movie-search.json';
import tvDetails from './__fixtures__/tv-details.json';
import movieDetails from './__fixtures__/movie-details.json';
import tvWatchProviders from './__fixtures__/tv-watch-providers.json';
import tvSeasonWatchProviders from './__fixtures__/tv-season-watch-providers.json';
import movieWatchProviders from './__fixtures__/movie-watch-providers.json';
import directoryTv from './__fixtures__/watch-provider-directory-tv.json';
import directoryMovie from './__fixtures__/watch-provider-directory-movie.json';
import error404 from './__fixtures__/error-404.json';
import error429 from './__fixtures__/error-429.json';

/** Builds a fetch mock that resolves to one fixed Response regardless of URL. */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof TmdbClient>[0]> = {}) {
  return new TmdbClient({
    readAccessToken: 'test-token',
    fetchImpl,
    // Keep tests fast: no throttling, no real sleeping between retries.
    requestsPerSecond: 1000,
    burstSize: 1000,
    ...overrides,
  });
}

describe('auth', () => {
  it('sends the v4 read access token as a bearer header, never as an api_key param', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).not.toContain('api_key');
      return jsonResponse(tvSearch);
    });
    const c = client(fetchMock as unknown as typeof fetch);
    await c.searchTv('Breaking Bad');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('returns a typed error and makes no request when no token is configured', async () => {
    const fetchMock = vi.fn();
    const c = new TmdbClient({ readAccessToken: undefined, fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await c.searchTv('anything');
    expect(result).toEqual({ kind: 'error', message: 'TMDB_READ_ACCESS_TOKEN is not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  it('parses /search/tv results', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(tvSearch));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.searchTv('Breaking Bad');
    expect(result).toEqual({ kind: 'ok', data: tvSearch });
  });

  it('parses /search/movie results', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(movieSearch));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.searchMovie('Inception');
    expect(result).toEqual({ kind: 'ok', data: movieSearch });
  });

  it('sends query, page and language as query params', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return jsonResponse(tvSearch);
    });
    const c = client(fetchMock as unknown as typeof fetch);
    await c.searchTv('Breaking Bad', { page: 2, language: 'en-US' });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/3/search/tv');
    expect(url.searchParams.get('query')).toBe('Breaking Bad');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('language')).toBe('en-US');
  });
});

describe('details', () => {
  it('fetches TV details including the season list', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(tvDetails));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvDetails(1396);
    expect(result).toEqual({ kind: 'ok', data: tvDetails });
    if (result.kind === 'ok') {
      expect(result.data.seasons).toHaveLength(2);
      expect(result.data.seasons[0].season_number).toBe(1);
    }
  });

  it('fetches movie details', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(movieDetails));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getMovieDetails(27205);
    expect(result).toEqual({ kind: 'ok', data: movieDetails });
  });
});

describe('watch providers', () => {
  it('fetches TV series watch providers from the dedicated endpoint', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return jsonResponse(tvWatchProviders);
    });
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvWatchProviders(1396);

    expect(new URL(requestedUrl).pathname).toBe('/3/tv/1396/watch/providers');
    expect(result).toEqual({ kind: 'ok', data: tvWatchProviders });
  });

  it('fetches season-level watch providers, which can disagree with series-level', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return jsonResponse(tvSeasonWatchProviders);
    });
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvSeasonWatchProviders(1396, 1);

    expect(new URL(requestedUrl).pathname).toBe('/3/tv/1396/season/1/watch/providers');
    expect(result).toEqual({ kind: 'ok', data: tvSeasonWatchProviders });

    // The series has a flatrate offer (Netflix). Season 1 does not - it is
    // rent/buy only. This is the exact disagreement the brief calls out, and
    // is why season providers must never be read off append_to_response.
    if (result.kind === 'ok') {
      const us = result.data.results.US;
      expect(us.flatrate).toBeUndefined();
      expect(us.buy?.map((p) => p.provider_name)).toContain('Apple TV');
    }
  });

  it('fetches movie watch providers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(movieWatchProviders));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getMovieWatchProviders(27205);
    expect(result).toEqual({ kind: 'ok', data: movieWatchProviders });
  });

  it('fetches the TV provider directory', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(directoryTv));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvWatchProviderDirectory({ watchRegion: 'US' });
    expect(result).toEqual({ kind: 'ok', data: directoryTv });
  });

  it('fetches the movie provider directory', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(directoryMovie));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getMovieWatchProviderDirectory({ watchRegion: 'US' });
    expect(result).toEqual({ kind: 'ok', data: directoryMovie });
  });
});

describe('404 handling', () => {
  it('surfaces a 404 as a typed not_found result, not a thrown exception', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(error404, 404));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvSeasonWatchProviders(999999, 1);
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('never retries a 404', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(error404, 404));
    const c = client(fetchMock as unknown as typeof fetch, { maxRetries: 3 });
    await c.getMovieWatchProviders(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('empty body handling', () => {
  it('distinguishes an empty 200 body from not_found and from a transport error', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvWatchProviders(1396);
    expect(result).toEqual({ kind: 'empty' });
  });

  it('treats an empty results object as empty, not ok with nothing in it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const c = client(fetchMock as unknown as typeof fetch);
    const result = await c.getTvWatchProviders(1396);
    expect(result).toEqual({ kind: 'empty' });
  });
});

describe('429 handling', () => {
  it('retries on 429 with backoff and succeeds once the limit clears', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(error429, 429, { 'retry-after': '0' });
      return jsonResponse(tvWatchProviders);
    });
    const c = client(fetchMock as unknown as typeof fetch, { maxRetries: 2 });
    const result = await c.getTvWatchProviders(1396);

    expect(calls).toBe(2);
    expect(result).toEqual({ kind: 'ok', data: tvWatchProviders });
  });

  it('surfaces a typed error once retries are exhausted on sustained 429s', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(error429, 429, { 'retry-after': '0' }));
    const c = client(fetchMock as unknown as typeof fetch, { maxRetries: 2 });
    const result = await c.getTvWatchProviders(1396);

    // Initial attempt plus two retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      kind: 'error',
      httpStatus: 429,
      message: error429.status_message,
    });
  });
});

describe('5xx handling', () => {
  it('retries on 500 and eventually surfaces a typed error', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, status_code: 500, status_message: 'Internal error' }), {
          status: 500,
        }),
    );
    const c = client(fetchMock as unknown as typeof fetch, { maxRetries: 1 });
    const result = await c.getMovieDetails(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.httpStatus).toBe(500);
    }
  });
});

describe('transport failure', () => {
  it('surfaces a network failure as a typed error after retries', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.themoviedb.org');
    });
    const c = client(fetchMock as unknown as typeof fetch, { maxRetries: 1 });
    const result = await c.getMovieDetails(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ kind: 'error', message: 'getaddrinfo ENOTFOUND api.themoviedb.org' });
  });
});

describe('rate limiting', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('spaces requests out to respect a configured requests-per-second budget', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(movieDetails));
    // One token per second, no burst - the second call must wait.
    const c = client(fetchMock as unknown as typeof fetch, { requestsPerSecond: 1000, burstSize: 1 });
    // Drain the single token, then a second call should still resolve
    // (the bucket refills continuously) without throwing.
    await c.getMovieDetails(1);
    await c.getMovieDetails(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
