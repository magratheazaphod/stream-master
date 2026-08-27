-- Who approved a pause.
--
-- `approved` records that somebody said yes. It does not record who, and for an
-- irreversible action a scheduled agent executes unattended that is a real gap:
-- a cancelled subscription with no actor is a decision nobody can be asked about.
--
-- Nullable, and it stays nullable. Every request written before this column
-- existed has no answer, and inventing one would be worse than the gap. A family
-- member who skipped the person picker still gets to pause their own
-- subscription, and their request carries null rather than a name they never
-- gave.
--
-- Attribution, not proof. Four households share one password, so this is the
-- name somebody chose on the way in. It is deliberately free text and not a
-- reference to `people`: the queue file is a record of what was approved as it
-- was named at the time, exactly like `service_name` and `household_name` beside
-- it, and a person row that gets renamed or deleted later must not rewrite the
-- history of a cancellation.
--
-- `approved` remains the only gate. Nothing reads this column to decide whether
-- Cowork may act.

alter table pause_requests
  add column approved_by text,
  add constraint pause_requests_approved_by_not_blank
    check (approved_by is null or btrim(approved_by) <> '');
