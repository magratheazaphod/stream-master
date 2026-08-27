/**
 * Load `data/family.json` into Postgres. `npm run db:import`.
 *
 * A one-time move, run again as often as you like. The file that exists on
 * Jesse's Mac today becomes the seeded database the hosted app reads, and the
 * file stays where it is: this script never deletes it, because it is the only
 * copy until the import has been checked.
 *
 * Two properties, and the whole script is arranged around them.
 *
 * **It refuses rather than reports nothing.** A missing `data/family.json` is
 * the ordinary state of a fresh clone and the app treats it as "run on demo
 * data". Here it is a stop, because an import that finds no file, writes no
 * rows and exits zero is indistinguishable from one that worked, and the next
 * person would go looking for their data in the wrong place.
 *
 * **It is idempotent.** Every write is an upsert keyed on the id the file
 * already carries, and the whole thing runs in one transaction. Running it
 * twice leaves the same rows. Running it after an edit updates them. Rows the
 * file no longer mentions are deleted, so the database matches the file rather
 * than accumulating what the file used to say - which is what makes the second
 * run mean something.
 *
 * The pause queue is deliberately untouched. Those rows are a record of what
 * somebody approved, they are not in the file, and an import that cleared them
 * would lose the evidence Cowork wrote back.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFamilyFile } from '../lib/family-file';
import type { FamilyFile } from '../lib/family-file';
import type { Offer } from '../lib/types';
import { connect } from '../lib/store/db';
import { describe, repoRoot, requireConnectionString } from './lib/env.mjs';

const path = process.argv[2] ?? join(repoRoot, 'data', 'family.json');

if (!existsSync(path)) {
  console.error(
    `No file at ${path}.\n` +
      'Nothing was imported. This machine may not be the one holding the real data:\n' +
      'the file is gitignored and lives only where somebody put it. Pass a path as\n' +
      'the first argument if it is somewhere else.',
  );
  process.exit(1);
}

// The same checker the app runs, and the reason this script does not validate
// anything itself. A file that would be refused at read time must be refused
// here too, or the import becomes a way to smuggle a broken dataset past it.
const family: FamilyFile = parseFamilyFile(readFileSync(path, 'utf8'), path);

const url = requireConnectionString();
// The app's own connector, so a script sees the same values the app does.
// Dates in particular: it keeps them as the ISO days they are, and a Date
// object here would put a timestamp in the queue file Cowork parses.
const sql = connect(url, { max: 1 });

/** The offers table, flattened out of the fixture shape the file stores. */
function offerRows(file: FamilyFile) {
  const rows: {
    title_id: string;
    season_number: number | null;
    service_id: string;
    kind: Offer['kind'];
    price: number | null;
  }[] = [];

  for (const [titleId, entry] of Object.entries(file.availability)) {
    const fixture = Array.isArray(entry) ? { series: entry } : entry;
    for (const offer of fixture.series ?? []) {
      rows.push({
        title_id: titleId,
        season_number: null,
        service_id: offer.serviceId,
        kind: offer.kind,
        price: offer.price ?? null,
      });
    }
    for (const [season, offers] of Object.entries(fixture.seasons ?? {})) {
      for (const offer of offers ?? []) {
        rows.push({
          title_id: titleId,
          season_number: Number(season),
          service_id: offer.serviceId,
          kind: offer.kind,
          price: offer.price ?? null,
        });
      }
    }
  }
  return rows;
}

/** When the offers for a title were observed, where the file recorded it. */
function observedAt(file: FamilyFile, titleId: string): string | null {
  const entry = file.availability[titleId];
  if (!entry || Array.isArray(entry)) return null;
  return entry.observedAt ?? null;
}

const offers = offerRows(family);

try {
  console.log(`Importing ${path} into ${describe(url)}`);

  await sql.begin(async (tx) => {
    await tx`
      insert into family_settings (singleton, country)
      values (true, ${family.country})
      on conflict (singleton) do update set country = excluded.country, updated_at = now()`;

    for (const h of family.households) {
      await tx`
        insert into households (id, name, location)
        values (${h.id}, ${h.name}, ${h.location})
        on conflict (id) do update set
          name = excluded.name, location = excluded.location, updated_at = now()`;
    }

    for (const p of family.people) {
      await tx`
        insert into people (id, name, household_id)
        values (${p.id}, ${p.name}, ${p.householdId})
        on conflict (id) do update set
          name = excluded.name, household_id = excluded.household_id, updated_at = now()`;
    }

    for (const s of family.services) {
      await tx`
        insert into services (id, name, monthly_price, sharing_policy, extra_member_price)
        values (${s.id}, ${s.name}, ${s.monthlyPrice}, ${s.sharingPolicy},
                ${s.extraMemberPrice ?? null})
        on conflict (id) do update set
          name = excluded.name,
          monthly_price = excluded.monthly_price,
          sharing_policy = excluded.sharing_policy,
          extra_member_price = excluded.extra_member_price,
          updated_at = now()`;

      // Terms removed from the file are removed here. A stale manage URL is the
      // one thing worse than none: it sends somebody to the wrong page.
      if (!s.pause) {
        await tx`delete from service_pause_terms where service_id = ${s.id}`;
        continue;
      }

      await tx`
        insert into service_pause_terms (service_id, method, manage_url, max_pause_months, verified_on)
        values (${s.id}, ${s.pause.method}, ${s.pause.manageUrl},
                ${s.pause.maxPauseMonths ?? null}, ${s.pause.verifiedOn})
        on conflict (service_id) do update set
          method = excluded.method,
          manage_url = excluded.manage_url,
          max_pause_months = excluded.max_pause_months,
          verified_on = excluded.verified_on,
          updated_at = now()`;

      // Replaced, not merged. An empty list is a real claim - the walkthrough
      // found nothing lost - and merging would make it unsayable.
      await tx`delete from service_pause_costs where service_id = ${s.id}`;
      for (const cost of s.pause.costs) {
        await tx`
          insert into service_pause_costs (service_id, cost)
          values (${s.id}, ${cost})
          on conflict do nothing`;
      }
    }

    for (const sub of family.subscriptions) {
      const paused = sub.status === 'paused';
      await tx`
        insert into subscriptions (
          id, service_id, household_id, payer_id, monthly_cost, billing_cycle,
          renews_on, status, paused_on, resume_by, last_used_on
        ) values (
          ${sub.id}, ${sub.serviceId}, ${sub.householdId}, ${sub.payerId},
          ${sub.monthlyCost}, ${sub.billingCycle}, ${sub.renewsOn},
          ${paused ? 'paused' : 'active'},
          ${paused ? (sub.pausedOn ?? null) : null},
          ${paused ? (sub.resumeBy ?? null) : null},
          ${sub.lastUsedOn ?? null}
        )
        on conflict (id) do update set
          service_id = excluded.service_id,
          household_id = excluded.household_id,
          payer_id = excluded.payer_id,
          monthly_cost = excluded.monthly_cost,
          billing_cycle = excluded.billing_cycle,
          renews_on = excluded.renews_on,
          status = excluded.status,
          paused_on = excluded.paused_on,
          resume_by = excluded.resume_by,
          last_used_on = excluded.last_used_on,
          updated_at = now()`;
    }

    for (const t of family.titles) {
      await tx`
        insert into watchlist_titles (id, name, release_year, kind, planned_month, offers_observed_at)
        values (${t.id}, ${t.name}, ${t.year}, ${t.kind}, ${t.plannedMonth},
                ${observedAt(family, t.id)})
        on conflict (id) do update set
          name = excluded.name,
          release_year = excluded.release_year,
          kind = excluded.kind,
          planned_month = excluded.planned_month,
          offers_observed_at = excluded.offers_observed_at,
          updated_at = now()`;
    }

    for (const n of family.interests) {
      await tx`
        insert into interests (title_id, person_id)
        values (${n.titleId}, ${n.personId})
        on conflict do nothing`;
    }

    // Offers are replaced wholesale rather than reconciled. They are hand
    // recorded notes with no identity of their own, so "the file no longer
    // says this" and "the file never said this" are the same fact about them.
    await tx`delete from watchlist_offers`;
    for (const row of offers) {
      await tx`
        insert into watchlist_offers (title_id, season_number, service_id, kind, price)
        values (${row.title_id}, ${row.season_number}, ${row.service_id}, ${row.kind}, ${row.price})`;
    }

    // Anything the file stopped mentioning goes, in dependency order. This is
    // what makes a second run mean "the database now matches the file" rather
    // than "the database holds every row the file has ever mentioned".
    //
    // `= any(array)` rather than `not in (list)`, because an empty list is a
    // syntax error and an empty table is a legitimate thing for the file to
    // describe. A family with nothing on its watchlist still has households.
    await tx`delete from interests where not (title_id = any(${(family.titles.map((t) => t.id))}))`;
    await tx`delete from interests where not (person_id = any(${(family.people.map((p) => p.id))}))`;
    await tx`delete from watchlist_titles where not (id = any(${(family.titles.map((t) => t.id))}))`;
    await tx`delete from subscriptions where not (id = any(${(family.subscriptions.map((s) => s.id))}))`;
    await tx`delete from services where not (id = any(${(family.services.map((s) => s.id))}))`;
    await tx`delete from people where not (id = any(${(family.people.map((p) => p.id))}))`;
    await tx`delete from households where not (id = any(${(family.households.map((h) => h.id))}))`;
  });

  const [counts] = await sql<{ households: string; people: string; services: string; subscriptions: string; titles: string }[]>`
    select (select count(*) from households)    as households,
           (select count(*) from people)        as people,
           (select count(*) from services)      as services,
           (select count(*) from subscriptions) as subscriptions,
           (select count(*) from watchlist_titles) as titles`;

  // Counts, never names. This output scrolls past in a terminal and gets pasted
  // into places a household name has no business reaching.
  console.log(
    `Done. ${counts.households} households, ${counts.people} people, ` +
      `${counts.services} services, ${counts.subscriptions} subscriptions, ` +
      `${counts.titles} watchlist titles, ${offers.length} recorded offers.`,
  );
} finally {
  await sql.end();
}
