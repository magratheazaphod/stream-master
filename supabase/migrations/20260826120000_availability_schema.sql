-- Availability schema - Stage 1 of docs/tmdb-integration.md.
--
-- The governing constraint: TMDB's series-level watch-providers response is a
-- union across all seasons. NCIS reports Netflix at the series level while
-- Netflix holds two of its twenty-three seasons. stream-master sells
-- sequencing, so the schema must keep the series union and the per-season
-- truth in separate rows and never let one be mistaken for the other.
--
-- Three properties this file exists to guarantee:
--
--   1. A series-union row and a season row are the same shape, distinguished
--      only by availability.season_number being null. Nothing collapses them.
--   2. Absence of an availability row never means "unavailable". It means
--      nobody asked, or the answer was empty. availability_fetch carries the
--      difference and is the only place that can answer "did we ask".
--   3. Country is a column everywhere, never an assumption. One household is
--      in London.
--
-- No row-level security. Shared visibility across the family is the feature.

begin;

-- Enums ---------------------------------------------------------------------

-- TMDB splits its catalogue into exactly these two.
create type media_type as enum ('tv', 'movie');

-- TMDB's own offer vocabulary, verbatim. rent and buy land here from day one
-- even though the first planner ignores them: annual-versus-monthly reasoning
-- needs the history and backfilling it is impossible.
create type offer_type as enum ('flatrate', 'free', 'ads', 'rent', 'buy');

-- Editorial classification of a provider, not something TMDB reports. The
-- Stage 0 spike found live-TV bundles produced half of all raw provider-season
-- splits; a household that owns no such bundle wants them excluded rather than
-- filtered downstream every time.
--
--   subscription      - a standalone monthly subscription. The planner's unit.
--   live_tv_bundle    - YouTube TV, fuboTV, Sling. Priced and reasoned about
--                       as pay-TV replacement, not as a catalogue.
--   channel_reseller  - the same catalogue resold inside another storefront,
--                       e.g. Paramount+ via Prime Video Channels.
--   transactional     - rent or buy only. No subscription decision to make.
--   free_ads          - free with advertising, no subscription decision.
--   unknown           - seen in the directory, not yet classified. Never
--                       silently treated as any of the above.
create type provider_kind as enum (
  'subscription',
  'live_tv_bundle',
  'channel_reseller',
  'transactional',
  'free_ads',
  'unknown'
);

-- What a single audited request asked for.
create type fetch_target as enum (
  'tv_series',
  'tv_season',
  'movie',
  'tv_details',
  'movie_details',
  'provider_directory'
);

-- The outcome vocabulary Stage 3 reasons over. EMPTY and NOT_FOUND are both
-- "unknown" to the product and both are distinct from never having asked.
create type fetch_result as enum ('OK', 'EMPTY', 'NOT_FOUND', 'ERROR');

-- providers -----------------------------------------------------------------

-- Seeded from /watch/providers/tv and /watch/providers/movie. provider_id is
-- TMDB's, so a live refresh is an upsert rather than a reconciliation.
--
-- canonical_provider_id is the variant collapse the Stage 0 spike demanded.
-- `Netflix` and `Netflix Standard with Ads` are one subscription decision, as
-- are the six Paramount+ SKUs; unmerged, CSI alone contributed six splits
-- describing one fact. A row points at the provider whose subscription it
-- actually is, or at nothing when it is already canonical.
create table providers (
  provider_id           integer primary key,
  name                  text not null,
  logo_path             text,
  -- TMDB's US ordering hint. Per-country priorities live in the jsonb below.
  display_priority      integer,
  display_priorities    jsonb not null default '{}'::jsonb,
  kind                  provider_kind not null default 'unknown',
  canonical_provider_id integer references providers (provider_id)
                          on update cascade on delete set null,
  -- Which TMDB directory listed it. A provider can appear in both.
  in_tv_directory       boolean not null default false,
  in_movie_directory    boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint providers_canonical_not_self
    check (canonical_provider_id is distinct from provider_id)
);

create index providers_canonical_idx
  on providers (canonical_provider_id)
  where canonical_provider_id is not null;

create index providers_kind_idx on providers (kind);

comment on column providers.canonical_provider_id is
  'The provider whose subscription this row is a variant of. Null means this row is itself the subscription decision. Collapse variants by coalesce(canonical_provider_id, provider_id).';

-- titles --------------------------------------------------------------------

-- TMDB id plus media type is the natural key. No surrogate id shadows it: the
-- two spaces of TMDB ids overlap, so neither column identifies a title alone.
create table titles (
  tmdb_id      integer not null,
  media_type   media_type not null,
  name         text not null,
  release_year smallint,
  -- Kept for search disambiguation and for the season-sampling budget. TMDB's
  -- season count and the count that returns provider data diverge legitimately
  -- (an unaired season), so this is a hint, never an authority.
  season_count smallint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tmdb_id, media_type),
  constraint titles_release_year_sane
    check (release_year is null or release_year between 1870 and 2200),
  constraint titles_season_count_sane
    check (season_count is null or season_count >= 0)
);

create index titles_name_idx on titles (lower(name));

-- title_seasons -------------------------------------------------------------

-- TV only. Season 0 is TMDB's specials bucket and is allowed through: the
-- planner may ignore it, but discarding it here would lose data we already
-- paid a request for.
create table title_seasons (
  title_tmdb_id  integer not null,
  media_type     media_type not null default 'tv',
  season_number  smallint not null,
  tmdb_season_id integer,
  episode_count  smallint,
  air_date       date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (title_tmdb_id, season_number),
  constraint title_seasons_tv_only check (media_type = 'tv'),
  constraint title_seasons_season_number_sane check (season_number >= 0),
  constraint title_seasons_episode_count_sane
    check (episode_count is null or episode_count >= 0),
  foreign key (title_tmdb_id, media_type)
    references titles (tmdb_id, media_type) on delete cascade
);

-- Unique so the composite foreign key from availability has a target.
create unique index title_seasons_natural_key_idx
  on title_seasons (title_tmdb_id, media_type, season_number);

-- availability --------------------------------------------------------------

-- One observed offer: this provider carried this title, in this country, under
-- this offer type, on this day.
--
-- season_number null means the row came from the series-level union. That is a
-- weaker claim than a season row, not an equivalent one, and no query may
-- substitute one for the other. Rows are appended, never deleted or updated in
-- place, so the table is a history of what was true when.
create table availability (
  id             bigint generated always as identity primary key,
  title_tmdb_id  integer not null,
  media_type     media_type not null,
  -- Null: series-level union. Non-null: a season we asked about directly.
  season_number  smallint,
  provider_id    integer not null references providers (provider_id)
                   on update cascade,
  country        text not null,
  offer_type     offer_type not null,
  observed_at    timestamptz not null default now(),
  -- Day grain for idempotency. Two refresh runs in a day produce one logical
  -- row; the next day appends a new one and the history keeps growing.
  observed_on    date not null default (now() at time zone 'utc')::date,
  -- The request that produced this row. Provenance, and the join that answers
  -- "how did we learn this".
  fetch_id       bigint,
  constraint availability_country_iso3166
    check (country ~ '^[A-Z]{2}$'),
  constraint availability_season_number_sane
    check (season_number is null or season_number >= 0),
  constraint availability_season_is_tv
    check (season_number is null or media_type = 'tv'),
  foreign key (title_tmdb_id, media_type)
    references titles (tmdb_id, media_type) on delete cascade,
  -- Only enforced when season_number is present, which is exactly right: a
  -- series-union row belongs to no season.
  foreign key (title_tmdb_id, media_type, season_number)
    references title_seasons (title_tmdb_id, media_type, season_number)
    on delete cascade
);

-- Two partial unique indexes rather than one, because Postgres treats nulls as
-- distinct in a unique index and would happily store a hundred duplicate
-- series-union rows for the same day.
create unique index availability_season_day_uniq
  on availability (title_tmdb_id, media_type, season_number, provider_id, country, offer_type, observed_on)
  where season_number is not null;

create unique index availability_series_day_uniq
  on availability (title_tmdb_id, media_type, provider_id, country, offer_type, observed_on)
  where season_number is null;

-- The planner's read path: everything known about one title in one country.
create index availability_title_country_idx
  on availability (title_tmdb_id, media_type, country, observed_on desc);

-- The refresh job's stale-first ordering.
create index availability_observed_at_idx on availability (observed_at desc);

create index availability_provider_idx
  on availability (provider_id, country, offer_type);

create index availability_fetch_id_idx
  on availability (fetch_id)
  where fetch_id is not null;

-- availability_fetch --------------------------------------------------------

-- The audit table, one row per request. Load-bearing, not bookkeeping: it is
-- the only thing that distinguishes unknown from unavailable. An availability
-- table with no row for a title says nothing at all on its own. Paired with an
-- OK fetch that wrote zero rows, it says the provider list was genuinely
-- empty; paired with nothing, it says nobody has looked.
create table availability_fetch (
  id             bigint generated always as identity primary key,
  target         fetch_target not null,
  -- Null for a provider_directory fetch, which asks about no title.
  title_tmdb_id  integer,
  media_type     media_type,
  season_number  smallint,
  -- The country slice we read out of the response. TMDB returns every country
  -- in one payload, so this records what we looked at, not what we sent.
  country        text,
  requested_url  text,
  http_status    integer,
  result         fetch_result not null,
  -- How many availability rows this request produced. Zero with result OK is
  -- the "asked, genuinely nothing there" case.
  rows_written   integer not null default 0,
  error_message  text,
  requested_at   timestamptz not null default now(),
  duration_ms    integer,
  constraint availability_fetch_country_iso3166
    check (country is null or country ~ '^[A-Z]{2}$'),
  constraint availability_fetch_title_pair
    check ((title_tmdb_id is null) = (media_type is null)),
  constraint availability_fetch_directory_has_no_title
    check (target <> 'provider_directory' or title_tmdb_id is null),
  constraint availability_fetch_title_targets_have_title
    check (target = 'provider_directory' or title_tmdb_id is not null),
  constraint availability_fetch_season_only_for_seasons
    check ((target = 'tv_season') = (season_number is not null)),
  constraint availability_fetch_error_has_message
    check (result <> 'ERROR' or error_message is not null),
  constraint availability_fetch_rows_written_sane check (rows_written >= 0)
);

-- Deliberately not a cascade and deliberately not enforced against titles: an
-- audit row for a title TMDB could not resolve must survive, and that title
-- may never exist in titles at all.
alter table availability
  add constraint availability_fetch_id_fkey
  foreign key (fetch_id) references availability_fetch (id) on delete set null;

-- "When did we last ask about this title", the refresh job's stale-first key.
create index availability_fetch_title_idx
  on availability_fetch (title_tmdb_id, media_type, requested_at desc)
  where title_tmdb_id is not null;

create index availability_fetch_requested_at_idx
  on availability_fetch (requested_at desc);

create index availability_fetch_result_idx
  on availability_fetch (result, requested_at desc)
  where result <> 'OK';

-- Views ---------------------------------------------------------------------

-- availability is append-only, so nearly every read wants the most recent
-- observation of each logical row and not the history behind it. This view is
-- the only sanctioned way to get it. It classifies nothing: whether a
-- provider's coverage of a title is full or partial is Stage 3's judgment, and
-- deciding it here would bury the semantics in SQL.
create view availability_latest as
select distinct on (title_tmdb_id, media_type, season_number, provider_id, country, offer_type)
       id,
       title_tmdb_id,
       media_type,
       season_number,
       provider_id,
       country,
       offer_type,
       observed_at,
       observed_on,
       fetch_id
  from availability
 order by title_tmdb_id, media_type, season_number, provider_id, country, offer_type,
          observed_on desc, observed_at desc, id desc;

comment on view availability_latest is
  'Most recent observation of each logical offer. Still separates series-union rows (season_number null) from season rows - never coalesce the two.';

commit;
