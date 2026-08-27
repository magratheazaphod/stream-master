/**
 * Transport-only TMDB v3 HTTP client. No domain types, no normalization, no
 * business logic - this just calls TMDB and hands back typed results. The
 * adapter that maps these onto the app's own model lives elsewhere.
 *
 * Two things about TMDB that are easy to get wrong and expensive to debug:
 *
 * - Auth is the v4 read access token as a bearer header, not the v3 api_key
 *   query parameter. The watch-provider endpoints reject the old scheme.
 * - Watch providers must be fetched from their own endpoints, never via
 *   append_to_response. For TV, the appended data disagrees with the
 *   dedicated endpoint.
 */

import type {
  TmdbErrorBody,
  TmdbMovieDetails,
  TmdbMovieSearchResult,
  TmdbPaginatedResponse,
  TmdbTvDetails,
  TmdbTvSearchResult,
  TmdbWatchProviderDirectoryResponse,
  TmdbWatchProvidersResponse,
} from './types';

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/** Every call resolves to exactly one of these - never a thrown exception. */
export type TmdbResult<T> =
  | { kind: 'ok'; data: T }
  /** TMDB answered with a real 404. For the provider endpoints this means
   *  "no providers", which the adapter must be able to tell apart from a
   *  transport failure. */
  | { kind: 'not_found' }
  /** TMDB returned 200 with a body that parsed to nothing usable (empty
   *  string, null, or an object with no results). Distinct from not_found:
   *  the request succeeded, there is just nothing there. */
  | { kind: 'empty' }
  /** Anything else: network failure, a non-404 HTTP error TMDB reported, or
   *  a body that failed to parse as JSON. */
  | { kind: 'error'; httpStatus?: number; message: string };

export interface TmdbClientConfig {
  /** Defaults to process.env.TMDB_READ_ACCESS_TOKEN. */
  readAccessToken?: string;
  baseUrl?: string;
  /** Sustained request rate. TMDB no longer publishes a hard cap; stay
   *  conservative rather than tuning this up. */
  requestsPerSecond?: number;
  /** Token bucket capacity, i.e. how large a burst is allowed. */
  burstSize?: number;
  maxRetries?: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface WatchProvidersQuery {
  language?: string;
}

interface ProviderDirectoryQuery {
  language?: string;
  watchRegion?: string;
}

interface SearchQuery {
  page?: number;
  language?: string;
}

/**
 * A token bucket limiting sustained request rate. Refills continuously
 * rather than in discrete ticks, so a caller that has been idle can burst up
 * to the bucket size and then settles back to the steady rate.
 */
class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;

  constructor(ratePerSecond: number, capacity: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = ratePerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Resolves once a token is available, consuming it. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const shortfall = 1 - this.tokens;
      const waitMs = Math.max(1, Math.ceil(shortfall / this.refillPerMs));
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class TmdbClient {
  private readonly token: string | undefined;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly bucket: TokenBucket;

  constructor(config: TmdbClientConfig = {}) {
    this.token = config.readAccessToken ?? process.env.TMDB_READ_ACCESS_TOKEN;
    this.baseUrl = config.baseUrl ?? TMDB_BASE_URL;
    this.maxRetries = config.maxRetries ?? 3;
    this.fetchImpl = config.fetchImpl ?? fetch;
    const rate = config.requestsPerSecond ?? 20;
    this.bucket = new TokenBucket(rate, config.burstSize ?? rate);
  }

  // -- Search -------------------------------------------------------------

  searchTv(query: string, opts: SearchQuery = {}): Promise<TmdbResult<TmdbPaginatedResponse<TmdbTvSearchResult>>> {
    return this.request('/search/tv', { query, ...this.searchParams(opts) });
  }

  searchMovie(
    query: string,
    opts: SearchQuery = {},
  ): Promise<TmdbResult<TmdbPaginatedResponse<TmdbMovieSearchResult>>> {
    return this.request('/search/movie', { query, ...this.searchParams(opts) });
  }

  private searchParams(opts: SearchQuery): Record<string, string> {
    const params: Record<string, string> = {};
    if (opts.page !== undefined) params.page = String(opts.page);
    if (opts.language) params.language = opts.language;
    return params;
  }

  // -- Details --------------------------------------------------------------

  getTvDetails(id: number): Promise<TmdbResult<TmdbTvDetails>> {
    return this.request(`/tv/${id}`);
  }

  getMovieDetails(id: number): Promise<TmdbResult<TmdbMovieDetails>> {
    return this.request(`/movie/${id}`);
  }

  // -- Watch providers, always via their own endpoints -----------------------

  getTvWatchProviders(id: number, opts: WatchProvidersQuery = {}): Promise<TmdbResult<TmdbWatchProvidersResponse>> {
    return this.request(`/tv/${id}/watch/providers`, this.watchProvidersParams(opts));
  }

  getTvSeasonWatchProviders(
    id: number,
    seasonNumber: number,
    opts: WatchProvidersQuery = {},
  ): Promise<TmdbResult<TmdbWatchProvidersResponse>> {
    return this.request(`/tv/${id}/season/${seasonNumber}/watch/providers`, this.watchProvidersParams(opts));
  }

  getMovieWatchProviders(
    id: number,
    opts: WatchProvidersQuery = {},
  ): Promise<TmdbResult<TmdbWatchProvidersResponse>> {
    return this.request(`/movie/${id}/watch/providers`, this.watchProvidersParams(opts));
  }

  private watchProvidersParams(opts: WatchProvidersQuery): Record<string, string> {
    const params: Record<string, string> = {};
    if (opts.language) params.language = opts.language;
    return params;
  }

  // -- Provider directory -----------------------------------------------------

  getTvWatchProviderDirectory(
    opts: ProviderDirectoryQuery = {},
  ): Promise<TmdbResult<TmdbWatchProviderDirectoryResponse>> {
    return this.request('/watch/providers/tv', this.directoryParams(opts));
  }

  getMovieWatchProviderDirectory(
    opts: ProviderDirectoryQuery = {},
  ): Promise<TmdbResult<TmdbWatchProviderDirectoryResponse>> {
    return this.request('/watch/providers/movie', this.directoryParams(opts));
  }

  private directoryParams(opts: ProviderDirectoryQuery): Record<string, string> {
    const params: Record<string, string> = {};
    if (opts.language) params.language = opts.language;
    if (opts.watchRegion) params.watch_region = opts.watchRegion;
    return params;
  }

  // -- Transport --------------------------------------------------------------

  private buildUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<TmdbResult<T>> {
    if (!this.token) {
      return { kind: 'error', message: 'TMDB_READ_ACCESS_TOKEN is not set' };
    }

    const url = this.buildUrl(path, params);
    let attempt = 0;

    for (;;) {
      await this.bucket.acquire();

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
          },
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(backoffMs(attempt));
          attempt += 1;
          continue;
        }
        return { kind: 'error', message: err instanceof Error ? err.message : 'network error' };
      }

      if (response.status === 404) {
        // A real answer, never a retry target - the adapter needs to see it.
        return { kind: 'not_found' };
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          await sleep(retryAfter ?? backoffMs(attempt));
          attempt += 1;
          continue;
        }
        const body = await safeJson<TmdbErrorBody>(response);
        const message = body?.status_message ?? `TMDB request failed with status ${response.status}`;
        return { kind: 'error', httpStatus: response.status, message };
      }

      const text = await response.text();
      if (text.length === 0) {
        return { kind: 'empty' };
      }

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        return { kind: 'error', httpStatus: response.status, message: 'TMDB returned a body that was not valid JSON' };
      }

      if (data === null || (typeof data === 'object' && Object.keys(data as object).length === 0)) {
        return { kind: 'empty' };
      }

      return { kind: 'ok', data };
    }
  }
}

async function safeJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  const jitter = Math.random() * 250;
  return base + jitter;
}

/** Convenience singleton for call sites that do not need a custom config. */
export const tmdbClient = new TmdbClient();
