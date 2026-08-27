-- Rollback of 20260826120000_availability_schema.sql.
--
-- Drops in dependency order and drops nothing it did not create. Running this
-- against a database that has real availability history destroys that history:
-- availability rows are append-only precisely because they cannot be
-- reconstructed from TMDB, which reports today and keeps no past.

begin;

drop view if exists availability_latest;

drop table if exists availability;
drop table if exists availability_fetch;
drop table if exists title_seasons;
drop table if exists titles;
drop table if exists providers;

drop type if exists fetch_result;
drop type if exists fetch_target;
drop type if exists provider_kind;
drop type if exists offer_type;
drop type if exists media_type;

commit;
