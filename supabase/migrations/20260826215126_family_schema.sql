-- The family domain - households, people, services, subscriptions, the watchlist
-- and the pause queue.
--
-- Stage 1 gave the database availability facts, which are public and belong to
-- nobody. This migration gives it the opposite: what four households actually
-- pay for. `data/family.json` held that until now, and a read-only serverless
-- filesystem ended the arrangement. These tables are where it lives instead.
--
-- The file is the specification. `lib/family-file.ts` refuses a private file
-- that cannot be trusted, and every check it makes appears here as a constraint,
-- because a rule enforced in one storage backend and not the other is a rule
-- that holds until somebody writes through the wrong door. Where a check reads
-- oddly, the parser is why.
--
-- Four properties this file exists to guarantee:
--
--   1. An empty database is empty, not wrong. Zero households is the honest
--      "no private data here" state and the app serves the demo dataset on it.
--      Partial private data is a different thing and the loader refuses it.
--   2. Pause terms are absent or complete, never half-recorded. A service with
--      no `service_pause_terms` row means nobody walked that provider's flow.
--      A row that exists carries a method, a URL and the date somebody checked.
--   3. A paused subscription says when billing stopped and an active one does
--      not carry a stale resume date. Both directions, both enforced.
--   4. A pause request records what was approved, not what the row said later.
--
-- No row-level security. Shared visibility across the family is the feature and
-- the app's shared-password gate is the access control. What that posture needs
-- instead is the grant revocation at the foot of this file: these tables hold
-- real names and real spend, the Supabase Data API exposes `public` to whatever
-- `anon` can reach, and the publishable key ships to every browser. The app
-- reaches these tables over SQL as the owner and PostgREST has no business here.

begin;

-- Enums ---------------------------------------------------------------------

-- Each of these mirrors a union type in lib/types.ts one for one. An enum
-- rather than a text column with a check: the app and the database then share a
-- vocabulary that a migration has to widen deliberately.

create type sharing_policy as enum ('household-only', 'extra-member', 'two-adults');

create type pause_method as enum ('native-pause', 'cancel-resubscribe', 'store-managed');

create type pause_cost as enum (
  'downloads',
  'watch-list',
  'profiles',
  'grandfathered-price',
  'annual-term-forfeit'
);

create type billing_cycle as enum ('monthly', 'annual');

create type subscription_status as enum ('active', 'paused');

create type title_kind as enum ('series', 'film');

-- Deliberately not Stage 1's `offer_type`. That enum is TMDB's vocabulary and
-- carries `free` and `ads`, which the domain's OfferKind cannot represent. A
-- shared enum would let a row into these tables that the app could not read
-- back out.
create type watchlist_offer_kind as enum ('flatrate', 'rent', 'buy');

create type pause_action as enum ('pause', 'resume');

-- The outcome vocabulary in docs/pause-automation.md, verbatim. Cowork writes
-- these and the app reads them; neither side may invent a sixth.
create type pause_outcome as enum ('done', 'already', 'blocked', 'failed', 'skipped');

-- family_settings -----------------------------------------------------------

-- The catalogue's country, and the only thing here that belongs to no table.
-- Availability is a per-country fact everywhere in this codebase, so the value
-- is a column somebody can change rather than a constant compiled into the app.
--
-- One row, forced. A settings table that quietly grows a second row is a
-- settings table nobody can read.
create table family_settings (
  singleton  boolean primary key default true,
  country    text not null,
  updated_at timestamptz not null default now(),
  constraint family_settings_one_row check (singleton),
  constraint family_settings_country_iso3166 check (country ~ '^[A-Z]{2}$')
);

-- households ----------------------------------------------------------------

-- Ids are the app's own strings, not surrogates. They are already stable, they
-- already appear in `data/family.json` and in every request id the pause queue
-- has ever written, and swapping in a uuid here would break that continuity for
-- nothing.
create table households (
  id         text primary key,
  name       text not null,
  -- Free text, and household sharing enforcement is geographic, so it is shown
  -- to the family rather than parsed. The country lives in family_settings.
  location   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_id_not_blank check (btrim(id) <> ''),
  constraint households_name_not_blank check (btrim(name) <> ''),
  constraint households_location_not_blank check (btrim(location) <> '')
);

-- people --------------------------------------------------------------------

create table people (
  id           text primary key,
  name         text not null,
  household_id text not null references households (id)
                 on update cascade on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint people_id_not_blank check (btrim(id) <> ''),
  constraint people_name_not_blank check (btrim(name) <> '')
);

create index people_household_idx on people (household_id);

-- services ------------------------------------------------------------------

-- A streaming provider as the family deals with it, priced and shared. Distinct
-- from Stage 1's `providers`, which is TMDB's directory: that table answers
-- "who carries this title", this one answers "what do we pay and may we share
-- it". Reconciling the two is Stage 3's job and neither is the other's key.
create table services (
  id                 text primary key,
  name               text not null,
  -- Money as numeric. A float here rounds a household's monthly total wrong and
  -- the whole product is a number somebody checks against a bank statement.
  monthly_price      numeric(10, 2) not null,
  sharing_policy     sharing_policy not null,
  -- Only where the provider sells one. Null means it does not.
  extra_member_price numeric(10, 2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint services_id_not_blank check (btrim(id) <> ''),
  constraint services_name_not_blank check (btrim(name) <> ''),
  constraint services_monthly_price_sane check (monthly_price >= 0),
  constraint services_extra_member_price_sane
    check (extra_member_price is null or extra_member_price >= 0)
);

-- service_pause_terms -------------------------------------------------------

-- What somebody learned by walking one provider's stop-billing flow by hand. No
-- API reports any of this.
--
-- A separate table rather than four nullable columns on `services`, because the
-- distinction the product turns on is presence: no row means nobody has walked
-- that flow and the app offers no button. Four nullable columns would make
-- "unrecorded" and "half-recorded" the same shape, and the app would eventually
-- send somebody to a null manage URL with their card out.
create table service_pause_terms (
  service_id        text primary key references services (id)
                      on update cascade on delete cascade,
  method            pause_method not null,
  -- The deep link that actually reaches the stop-billing page.
  manage_url        text not null,
  -- Longest pause the provider allows. Meaningful only for a native pause, and
  -- the constraint below says so in both directions: a native pause that does
  -- not name a limit is an unfinished record, and a limit on a method with no
  -- pause is a number the app would quote at a family and be wrong about.
  max_pause_months  smallint,
  -- ISO date somebody last walked this flow. Freshness is judged from it.
  verified_on       date not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint service_pause_terms_manage_url_is_https
    check (manage_url ~ '^https://'),
  constraint service_pause_terms_max_months_matches_method
    check ((method = 'native-pause') = (max_pause_months is not null)),
  constraint service_pause_terms_max_months_sane
    check (max_pause_months is null or max_pause_months > 0)
);

-- service_pause_costs -------------------------------------------------------

-- What pausing costs beyond the money. These are the reasons somebody refuses
-- to press the button.
--
-- The foreign key points at the terms and not at the service, which is the
-- whole reason this is its own table: a cost cannot be recorded for a provider
-- whose flow nobody walked. An empty set is legal and means the walkthrough
-- found nothing lost, which is a different claim from nobody having checked -
-- and the terms row is what tells the two apart.
create table service_pause_costs (
  service_id text not null references service_pause_terms (service_id)
               on update cascade on delete cascade,
  cost       pause_cost not null,
  primary key (service_id, cost)
);

-- subscriptions -------------------------------------------------------------

-- One household paying for one service. Paused is a state on this row, never a
-- deletion: the household expects to come back and the spend history needs it.
create table subscriptions (
  id            text primary key,
  service_id    text not null references services (id) on update cascade,
  household_id  text not null references households (id) on update cascade,
  payer_id      text not null references people (id) on update cascade,
  -- What this household actually pays, after any annual discount. Not
  -- services.monthly_price, which is the provider's list price.
  monthly_cost  numeric(10, 2) not null,
  billing_cycle billing_cycle not null,
  -- Next renewal. Meaningless while paused, kept anyway: it is what the row
  -- returns to when somebody presses resume.
  renews_on     date not null,
  -- Not null, unlike the optional field on the domain type. A file written
  -- before pausing existed omitted it and meant active; a row has no such
  -- history to honour, so the default carries the same meaning without the
  -- third state.
  status        subscription_status not null default 'active',
  paused_on     date,
  resume_by     date,
  -- Self-declared by the family. No viewing history is ingested anywhere, so
  -- null means nobody has answered yet and never "never watched".
  last_used_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint subscriptions_id_not_blank check (btrim(id) <> ''),
  constraint subscriptions_monthly_cost_sane check (monthly_cost >= 0),
  -- The parser's rule, both directions. A paused row that cannot say when
  -- billing stopped is a row nobody can compute a saving from, and an active
  -- row still carrying a resume date is how a household gets nagged about a
  -- service it is already paying for.
  constraint subscriptions_paused_on_matches_status
    check ((status = 'paused') = (paused_on is not null)),
  constraint subscriptions_resume_by_needs_a_pause
    check (resume_by is null or status = 'paused'),
  constraint subscriptions_resume_by_after_paused_on
    check (resume_by is null or paused_on is null or resume_by >= paused_on)
);

create index subscriptions_household_idx on subscriptions (household_id);
create index subscriptions_service_idx on subscriptions (service_id);
create index subscriptions_status_idx on subscriptions (status);
-- The renewal nudge's read path, and it wants live rows only.
create index subscriptions_renews_on_idx
  on subscriptions (renews_on)
  where status = 'active';

-- watchlist_titles ----------------------------------------------------------

-- What the family intends to watch, and when.
--
-- Not Stage 1's `titles`, and named apart on purpose. That table is keyed by
-- TMDB id and holds the catalogue's facts. This one is keyed by the family's
-- own id and holds an intention, which TMDB knows nothing about. Matching a row
-- here to a row there is a lookup somebody performs, never an assumption a
-- shared primary key smuggles in.
create table watchlist_titles (
  id                 text primary key,
  name               text not null,
  release_year       smallint not null,
  kind               title_kind not null,
  -- Month index across the planning horizon, 0 being the first month. This is
  -- the demand plan and it is what turns a wish list into a schedule.
  planned_month      smallint not null,
  -- When the recorded offers below were observed. One value per title, because
  -- they were written down in one sitting by a person, not fetched per row.
  offers_observed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint watchlist_titles_id_not_blank check (btrim(id) <> ''),
  constraint watchlist_titles_name_not_blank check (btrim(name) <> ''),
  constraint watchlist_titles_release_year_sane
    check (release_year between 1870 and 2200),
  constraint watchlist_titles_planned_month_sane check (planned_month >= 0)
);

-- interests -----------------------------------------------------------------

-- One person wanting one title. The count is what drives priority, so the
-- primary key doing the deduplication is load-bearing rather than tidy: the
-- same person recorded twice would vote twice.
create table interests (
  title_id   text not null references watchlist_titles (id)
               on update cascade on delete cascade,
  person_id  text not null references people (id)
               on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (title_id, person_id)
);

create index interests_person_idx on interests (person_id);

-- watchlist_offers ----------------------------------------------------------

-- A hand-recorded way to watch one watchlist title on one service. The family's
-- own notes, not a vendor's answer, which is why these rows sit here and not in
-- Stage 1's `availability`.
--
-- The same series-versus-season discipline Stage 1 established, for the same
-- reason: season_number null is the whole-title claim and a non-null one is a
-- season somebody checked directly. Reading the union alone is how a rotation
-- plan strands somebody in the middle of season four, so no query may
-- substitute one for the other.
create table watchlist_offers (
  title_id      text not null references watchlist_titles (id)
                  on update cascade on delete cascade,
  -- Null: the whole-title claim. Non-null: one season, checked directly.
  season_number smallint,
  service_id    text not null references services (id) on update cascade,
  kind          watchlist_offer_kind not null,
  -- Transactional price for rent and buy. Null where nobody recorded one, which
  -- is the ordinary case and exactly the gap TMDB leaves.
  price         numeric(10, 2),
  created_at    timestamptz not null default now(),
  constraint watchlist_offers_season_number_sane
    check (season_number is null or season_number >= 0),
  constraint watchlist_offers_price_sane check (price is null or price >= 0)
);

-- Two partial unique indexes rather than one, because Postgres treats nulls as
-- distinct and would happily store the same whole-title offer a hundred times.
create unique index watchlist_offers_season_uniq
  on watchlist_offers (title_id, season_number, service_id, kind)
  where season_number is not null;

create unique index watchlist_offers_series_uniq
  on watchlist_offers (title_id, service_id, kind)
  where season_number is null;

create index watchlist_offers_service_idx on watchlist_offers (service_id);

-- pause_requests ------------------------------------------------------------

-- What the family asked Cowork to do. The hosted app writes here and never to a
-- file; a sync job on Jesse's Mac carries these rows into
-- `data/pause-queue.json` and Cowork reads that. See docs/pause-automation.md -
-- the file contract is unchanged and the sync job absorbs the whole difference.
--
-- Two things about this table are not bookkeeping.
--
-- `approved` is the gate. Cowork skips anything that is not exactly true, and
-- without it a scheduled run could cancel a subscription nobody chose to
-- cancel. It is not null and it has no default: an approval nobody stated is
-- not an approval.
--
-- `handed_off_at` is the state the hosted app could not previously express. The
-- Mac is a required participant, so a request made while it is asleep sits here
-- untouched. Null means requested and nothing more; a timestamp means the sync
-- job pulled it into the queue file and an agent can act on it. The screen
-- shows the difference rather than implying somebody is standing by.
create table pause_requests (
  id              text primary key,
  subscription_id text not null references subscriptions (id)
                    on update cascade on delete cascade,
  service_id      text not null references services (id) on update cascade,
  -- Denormalised on purpose, both of them. The queue file is a record of what
  -- was approved, and an agent acting tomorrow must read the service and
  -- household as they were named when somebody pressed the button, not as the
  -- rows have since been edited.
  service_name    text not null,
  household_name  text not null,
  action          pause_action not null,
  -- Which flow the playbook walks. Copied from the terms at approval time for
  -- the same reason as the names above.
  method          pause_method not null,
  manage_url      text not null,
  approved        boolean not null,
  approved_at     timestamptz not null,
  resume_by       date,
  notes           text,
  -- Set by the sync job on the Mac when it writes this request into the queue
  -- file. The app only ever reads it.
  handed_off_at   timestamptz,
  created_at      timestamptz not null default now(),
  constraint pause_requests_id_not_blank check (btrim(id) <> ''),
  constraint pause_requests_manage_url_is_https check (manage_url ~ '^https://'),
  -- Only a pause has something to come back from.
  constraint pause_requests_resume_by_needs_a_pause
    check (resume_by is null or action = 'pause')
);

create index pause_requests_subscription_idx
  on pause_requests (subscription_id, created_at desc);

-- The sync job's read path: approved work the Mac has not taken yet.
create index pause_requests_pending_idx
  on pause_requests (created_at)
  where approved and handed_off_at is null;

-- pause_results -------------------------------------------------------------

-- What Cowork reported, pushed up by the same sync job. Append-only: the agent
-- appends to its file, later rows win, and rewriting an earlier one would erase
-- the record of a flow that failed before it worked.
--
-- Deliberately no constraint requiring evidence on a `done`. The contract says
-- an agent that clicked a button and assumed is reporting failed, but the
-- honest place to say so is the screen, which already renders that case as
-- "reported done, no evidence". Rejecting the row here would leave the app
-- unable to store what the agent actually said, which is the one thing an audit
-- record exists to hold.
create table pause_results (
  id               bigint generated always as identity primary key,
  request_id       text not null references pause_requests (id)
                     on update cascade on delete cascade,
  outcome          pause_outcome not null,
  -- When the agent saw it, as the agent reported it.
  observed_at      timestamptz not null,
  billing_stops_on date,
  -- The confirmation text the agent actually read. The only thing that earns
  -- the word stopped anywhere in this product.
  evidence         text,
  screenshot       text,
  -- When the sync job pushed it up, which is a different instant and is how a
  -- backlog after a sleeping Mac reads correctly.
  recorded_at      timestamptz not null default now()
);

-- The sync job pushes the whole results file every run, so re-pushing the same
-- result must not append a second row. Identity is the request, the outcome and
-- the instant the agent observed it.
create unique index pause_results_natural_key_uniq
  on pause_results (request_id, outcome, observed_at);

create index pause_results_request_idx
  on pause_results (request_id, observed_at desc, id desc);

-- Grants --------------------------------------------------------------------

-- The one control this schema does have, and it is here because there is no
-- row-level security to fall back on.
--
-- Supabase serves the `public` schema over PostgREST, and the publishable key
-- that reaches it ships to every browser the app renders in. These tables hold
-- real names, real households and real spend. The app reads them over SQL as
-- the owning role, so the Data API needs no access at all and gets none.
--
-- Revoking rather than never granting: Supabase's default privileges hand new
-- tables in `public` to both roles, so silence here would be a grant.
revoke all on family_settings, households, people, services, service_pause_terms,
  service_pause_costs, subscriptions, watchlist_titles, interests, watchlist_offers,
  pause_requests, pause_results
  from anon, authenticated;

commit;
