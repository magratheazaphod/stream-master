-- Rollback of 20260826220623_revoke_data_api_grants.sql.
--
-- Reopens the Data API on Stage 1's tables, which is what Supabase's defaults
-- did and what the forward migration exists to undo. Run it only to reproduce
-- the original state: with no row-level security on these tables, the grant it
-- restores lets anybody holding the publishable key write to them.

begin;

grant all on providers, titles, title_seasons, availability, availability_fetch
  to anon, authenticated;

grant all on availability_latest to anon, authenticated;

commit;
