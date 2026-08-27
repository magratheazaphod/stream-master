/**
 * Raw TMDB response shapes. These mirror the wire format exactly and carry no
 * domain meaning - the adapter maps these onto the app's own types. Field
 * names stay snake_case on purpose, matching TMDB's JSON, so a diff against
 * the docs is a visual diff, not a translation exercise.
 */

export interface TmdbPaginatedResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbTvSearchResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  origin_country: string[];
  original_language: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
}

export interface TmdbMovieSearchResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  original_language: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  video: boolean;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbTvSeasonSummary {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  episode_count: number;
  poster_path: string | null;
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  overview: string;
  first_air_date: string;
  last_air_date: string | null;
  status: string;
  number_of_seasons: number;
  number_of_episodes: number;
  genres: TmdbGenre[];
  origin_country: string[];
  original_language: string;
  seasons: TmdbTvSeasonSummary[];
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  runtime: number | null;
  status: string;
  genres: TmdbGenre[];
  original_language: string;
}

/** One provider offering a title, inside one of flatrate/free/ads/rent/buy. */
export interface TmdbWatchProviderOffer {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority: number;
}

/** A single country's slice of a watch/providers response. */
export interface TmdbCountryWatchProviders {
  link: string;
  flatrate?: TmdbWatchProviderOffer[];
  free?: TmdbWatchProviderOffer[];
  ads?: TmdbWatchProviderOffer[];
  rent?: TmdbWatchProviderOffer[];
  buy?: TmdbWatchProviderOffer[];
}

/**
 * The shared shape of /tv/{id}/watch/providers, /movie/{id}/watch/providers
 * and /tv/{id}/season/{season_number}/watch/providers. Keyed by ISO 3166-1
 * country code.
 */
export interface TmdbWatchProvidersResponse {
  id: number;
  results: Record<string, TmdbCountryWatchProviders>;
}

/** One entry in the provider directory - not tied to a title or country. */
export interface TmdbWatchProviderDirectoryEntry {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priorities: Record<string, number>;
}

export interface TmdbWatchProviderDirectoryResponse {
  results: TmdbWatchProviderDirectoryEntry[];
}

/** TMDB's own error body, present whenever a request fails at the API level. */
export interface TmdbErrorBody {
  success: false;
  status_code: number;
  status_message: string;
}
