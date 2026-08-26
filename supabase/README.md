# Database

Postgres via Supabase. No row-level security: shared visibility across the family is
the feature, not a leak.

Nothing in the app reads these tables yet. The prototype still reads
`data/family.example.json` through `lib/family-file.ts`, and Stage 5 of
`docs/tmdb-integration.md` is where reads move.

## Layout

- `migrations/` - forward migrations, applied in filename order by the Supabase CLI.
- `rollback/` - the matching reversal for each migration, same basename. The CLI has no
  down-migration concept, so these are run by hand with `psql`.
- `seed/providers.json` - the provider snapshot the seed script reads.

## Working locally

```sh
supabase start                                  # local stack, Postgres on 54322
supabase db reset                               # apply every migration from scratch
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run db:seed                                 # populate providers
npm run db:seed:sql                             # or just look at the SQL first
psql "$DATABASE_URL" -f supabase/rollback/<name>.sql   # reverse one migration
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
