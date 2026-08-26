# Database

Postgres via Supabase. No row-level security: shared visibility across the family is
the feature, not a leak.

The app reads the family tables through `lib/store/postgres.ts`. The
availability tables are still unread: Stage 5 of `docs/tmdb-integration.md` is
where that moves.

## Layout

- `migrations/` - forward migrations, applied in filename order by the Supabase CLI.
  Three of them: the availability schema, the family domain and a revocation of the
  Data API grants Supabase hands out by default.
- `rollback/` - the matching reversal for each migration, same basename. The CLI has no
  down-migration concept, so these are run by hand with `psql`.
- `seed/providers.json` - the provider snapshot the seed script reads.

## Working locally

```sh
supabase start                                  # local stack, Postgres on 54322
supabase db reset                               # apply every migration from scratch
npm run db:seed                                 # populate providers
npm run db:seed:sql                             # or just look at the SQL first
npm run db:import                               # load data/family.json
```

The connection comes from `.env.local`, which is what the app reads, so nothing
needs a `DATABASE_URL` exported. To point one command somewhere else, export
`POSTGRES_URL` for that command and it wins outright:

```sh
POSTGRES_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' npm run db:seed
```

`psql` is not on the PATH on Jesse's Mac. Reach the local database through the
container the CLI already runs:

```sh
docker exec -i supabase_db_stream-master psql \
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres' -v ON_ERROR_STOP=1 \
  -f - < supabase/rollback/<name>.sql
```

## The two kinds of column in `providers`

Directory fields - `name`, `logo_path`, `display_priority`, `display_priorities`,
`in_tv_directory`, `in_movie_directory` - mirror TMDB's `/watch/providers/{tv,movie}`.
A refresh overwrites them freely.

Editorial fields - `kind`, `canonical_provider_id`, `notes` - are stream-master's own
judgment, and TMDB reports neither. The seed's upsert fills them only where the row
carries nothing, so a live directory refresh cannot erase a classification somebody
made by hand. Any future refresh job must keep that split.

`provider_id` values in the seed were written from recall rather than a live directory
call, because Stage 1 makes no TMDB requests. Reconcile them against the live directory
before trusting planner output built on them.

## Access control

There is no row-level security anywhere, and that is the design: shared visibility
across the family is the feature, and the app's shared-password gate is the access
control. What that posture requires instead is that PostgREST cannot reach these
tables at all.

Supabase grants every new table in `public` to `anon` and `authenticated`, including
INSERT and TRUNCATE, and the publishable key that reaches those roles ships to every
browser. Both migrations that create tables revoke those grants, and
`20260826220623` closes the ones Stage 1 left open. The app connects as the owning
role over SQL and needs none of it.

Any future migration that creates a table in `public` must revoke the same grants.
Silence is a grant.

## Migration history

Both databases were migrated by hand, so `supabase_migrations.schema_migrations`
does not exist in either and the CLI has no record of what has been applied.
`supabase db push` would try to run all three from the top and fail on the first
`create type`. Reconcile that before the CLI is used against the hosted database.

## The family tables

`households`, `people`, `services`, `subscriptions`, `watchlist_titles`, `interests`
and the two pause-queue tables mirror `lib/types.ts` one for one. Every check in
`lib/family-file.ts` appears there as a constraint, because a rule enforced in one
storage backend and not the other holds only until somebody writes through the other
door.

Two names deserve their divergence. `watchlist_titles` is not `titles`: that one is
keyed by TMDB id and holds the catalogue's facts, while this one is keyed by the
family's own id and holds an intention TMDB knows nothing about. `services` is not
`providers`, for the same kind of reason - `providers` answers "who carries this
title" and `services` answers "what do we pay and may we share it".
