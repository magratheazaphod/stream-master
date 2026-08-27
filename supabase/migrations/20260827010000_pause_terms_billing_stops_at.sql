-- When billing actually stops.
--
-- Walking Hulu's flow found that its pause does not begin when somebody presses
-- the button. It begins at the next billing date: the household keeps watching,
-- and keeps paying, until then. Every other recorded method was assumed to stop
-- the money on the spot, and the app computed the resume date from the day of
-- the request on that assumption.
--
-- That assumption is wrong by up to a full billing period, and it fails in the
-- direction that matters. A resume date computed from the request date tells a
-- family a subscription is back before the provider will bring it back, which is
-- the exact failure `cowork/hulu-pause.md` was written to prevent.
--
-- Nullable, and it stays nullable. Null is "nobody established this on the
-- walkthrough", which is not the same as `immediately` and must never default to
-- it. Five of seven playbooks remain unverified; a default here would invent an
-- answer for all of them and the screen would quote it at somebody.
--
-- No grants to revoke: `service_pause_terms` already has none, and this adds a
-- column to an existing table rather than a table to `public`.

create type billing_stops_at as enum ('immediately', 'next-billing-date');

alter table service_pause_terms
  add column billing_stops_at billing_stops_at;

-- Recorded on the walkthrough of 2026-08-26, verbatim from Hulu's own pause
-- page: "You can pause your subscription for up to 12 weeks beginning on your
-- next billing date."
update service_pause_terms
   set billing_stops_at = 'next-billing-date'
 where service_id = 's-hulu';
