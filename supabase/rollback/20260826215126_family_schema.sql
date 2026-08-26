-- Rollback of 20260826215126_family_schema.sql.
--
-- Drops in dependency order and drops nothing it did not create. Running this
-- against a database holding real family data destroys that data outright:
-- these tables are the only copy once `data/family.json` has been imported, and
-- no vendor can reconstruct what four households pay.
--
-- The revoke at the foot of the forward migration needs no reversal. Dropping a
-- table takes its privileges with it.

begin;

drop table if exists pause_results;
drop table if exists pause_requests;
drop table if exists watchlist_offers;
drop table if exists interests;
drop table if exists watchlist_titles;
drop table if exists subscriptions;
drop table if exists service_pause_costs;
drop table if exists service_pause_terms;
drop table if exists services;
drop table if exists people;
drop table if exists households;
drop table if exists family_settings;

drop type if exists pause_outcome;
drop type if exists pause_action;
drop type if exists watchlist_offer_kind;
drop type if exists title_kind;
drop type if exists subscription_status;
drop type if exists billing_cycle;
drop type if exists pause_cost;
drop type if exists pause_method;
drop type if exists sharing_policy;

commit;
