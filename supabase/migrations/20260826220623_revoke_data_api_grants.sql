-- Close the Data API on Stage 1's tables.
--
-- Found while wiring the app to Postgres. Supabase's default privileges hand
-- every new table in `public` to `anon` and `authenticated`, and not only for
-- reads: the availability tables carried INSERT, UPDATE, DELETE and TRUNCATE.
-- The publishable key that reaches those roles over PostgREST ships to every
-- browser this app renders in, so anybody who opened the page could have
-- emptied the availability history from a console.
--
-- That history is the one thing in the database no vendor can rebuild. TMDB
-- reports what is true today and keeps no past, which is why `availability` is
-- append-only in the first place.
--
-- Nothing reads these tables through PostgREST. The app talks SQL as the owner
-- and Stage 4's refresh job will do the same, so the Data API needs no access
-- here at all. The family tables added in 20260826215126 already revoke this;
-- this is the same posture applied to the tables that predate it.

begin;

revoke all on providers, titles, title_seasons, availability, availability_fetch
  from anon, authenticated;

revoke all on availability_latest from anon, authenticated;

commit;
