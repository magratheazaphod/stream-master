-- Two households, not one click.
--
-- A cancellation was one press away from an unattended agent. The person picker
-- records who, but nothing required a second person, so a misclick on a shared
-- screen could end a subscription three other households watch.
--
-- The gate already existed and was never used: `approved` is what
-- `pause-sync.mts` filters on, and the app wrote `true` every time. Now the
-- first press writes `false` and the request is invisible to Cowork until
-- somebody from a different household agrees.
--
-- `approved_at` becomes nullable, because a request nobody has approved has no
-- approval time. The constraint ties the two together in both directions so the
-- pair cannot drift.
--
-- `requested_household` is the load-bearing column. A name alone cannot answer
-- "is this a second pair of eyes, or the same person pressing twice", and the
-- household is the unit the family actually thinks in.
--
-- This is a control on accidents, not on people. Four households share one
-- password and the picker is a name somebody chose, so a determined person can
-- pick a different name and approve their own request. That is the documented
-- posture of this app, and the rule is still worth having: the failure it
-- prevents is a slip, and slips do not switch identities first.
--
-- Rows written before this existed keep approved = true with a null requesting
-- household. They are already through the gate, and the app refuses to approve a
-- request it cannot check rather than inventing a household for it.
--
-- No grants to revoke: columns on an existing table, not a new table in public.

alter table pause_requests
  add column requested_by        text,
  add column requested_household text,
  add column approved_household  text,
  alter column approved_at drop not null;

alter table pause_requests
  add constraint pause_requests_approved_at_matches_approved
    check (approved = (approved_at is not null)),
  add constraint pause_requests_requested_by_not_blank
    check (requested_by is null or btrim(requested_by) <> ''),
  add constraint pause_requests_requested_household_not_blank
    check (requested_household is null or btrim(requested_household) <> ''),
  add constraint pause_requests_approved_household_not_blank
    check (approved_household is null or btrim(approved_household) <> ''),
  -- The rule itself, enforced where it cannot be forgotten. Null on either side
  -- is a request from before the rule, which the app declines to approve.
  add constraint pause_requests_second_household_differs
    check (
      requested_household is null
      or approved_household is null
      or requested_household <> approved_household
    );
