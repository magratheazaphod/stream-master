/**
 * The Postgres-backed store. What the hosted app runs on.
 *
 * The demo-versus-private rule is the same rule, in the same three outcomes,
 * and it survives the move deliberately. No households means no private data
 * and the app serves the demo dataset. Households that assemble into a
 * catalogue the checker accepts are private data. Households that do not throw,
 * and never degrade to demo, because a reader who cannot tell which family they
 * are looking at will eventually publish the wrong one.
 *
 * That last outcome is why this file assembles rows into the same shape
 * `lib/family-file.ts` checks and then runs `checkFamilyData` over it, rather
 * than trusting its own SELECTs. The database's constraints already forbid most
 * of what could go wrong, but "most" is the wrong number for a safety property,
 * and a rule enforced in one backend and not the other is a rule that holds
 * until somebody writes through the other door. One checker, both stores.
 */

import { MockAvailabilityProvider } from '../availability';
import { checkFamilyData, type SubscriptionStatusChange } from '../family-file';
import type { PauseRequest, PauseResult } from '../pause-queue';
import type { Offer, Subscription } from '../types';
import { connectionString, db, describeDatabase } from './db';
import { applyToRow, demoCatalog } from './file';
import type {
  CatalogStore,
  LoadedCatalog,
  PauseSnapshot,
  QueuedRequest,
  StatusWriteResult,
} from './types';
import type { Sql } from 'postgres';

/** Numeric columns arrive as strings, because a float would round money wrong. */
const money = (v: string | null): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

/** Null is the database's absent. The domain's absent is a missing key. */
const skipNull = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Timestamps reach the domain as ISO 8601 strings, never as Date objects. */
const iso = (v: Date | null): string | undefined => (v === null ? undefined : v.toISOString());

export class PostgresCatalogStore implements CatalogStore {
  readonly name: string;

  constructor(private readonly sql: Sql = db()) {
    const url = connectionString();
    this.name = url ? describeDatabase(url) : 'the configured database';
  }

  /** How the loader names its source. Host and database, never a credential. */
  private get label(): string {
    return `the family tables in ${this.name}`;
  }

  async load(): Promise<LoadedCatalog> {
    /**
     * One transaction, and it buys two separate things.
     *
     * The first is a consistent snapshot. These ten reads describe one family,
     * and `db:import` deletes and re-inserts rather than updating in place, so
     * ten independently-timed statements can straddle it and assemble a
     * catalogue out of two different moments. That assembly then fails the
     * checker with faults that contradict each other - subscriptions naming
     * households the households query no longer returned. `repeatable read`
     * gives every statement here the same snapshot, so the assembled shape is
     * one the database actually held.
     *
     * The second is a bound on concurrency. `Promise.all` over ten queries on a
     * pool of five wedges the pool permanently: the first request succeeds, the
     * overflow queue never drains, and every later request on that warm
     * instance hangs until the platform times it out at 300 seconds. Reproduced
     * 6 times in 6 against the hosted pooler on a bare `select 1`, and never
     * once when in-flight queries stayed within `max`. A transaction reserves a
     * single connection and runs these statements down it, so the fan-out
     * cannot exceed the pool however many queries this list grows to.
     *
     * The reads stay in one `Promise.all` because postgres.js pipelines them
     * down that connection: they are issued together and the round trips
     * overlap. One connection is measurably faster than five were - a warm load
     * went from 475ms to 160ms - because the five spent their time contending
     * for the pool rather than waiting on Postgres.
     */
    return this.sql.begin('isolation level repeatable read', async (sql) => {
      return this.loadWithin(sql as unknown as Sql);
    }) as Promise<LoadedCatalog>;
  }

  /** The reads and the assembly, given a connection that holds the snapshot. */
  private async loadWithin(sql: Sql): Promise<LoadedCatalog> {
    const [
      settings,
      households,
      people,
      services,
      pauseTerms,
      pauseCosts,
      subscriptions,
      titles,
      interests,
      offers,
    ] = await Promise.all([
      sql<{ country: string }[]>`select country from family_settings`,
      sql<{ id: string; name: string; location: string }[]>`
        select id, name, location from households order by id`,
      sql<{ id: string; name: string; household_id: string }[]>`
        select id, name, household_id from people order by id`,
      sql<
        {
          id: string;
          name: string;
          monthly_price: string;
          sharing_policy: string;
          extra_member_price: string | null;
        }[]
      >`select id, name, monthly_price, sharing_policy, extra_member_price
          from services order by id`,
      sql<
        {
          service_id: string;
          method: string;
          manage_url: string;
          max_pause_months: number | null;
          verified_on: string;
        }[]
      >`select service_id, method, manage_url, max_pause_months, verified_on
          from service_pause_terms`,
      sql<{ service_id: string; cost: string }[]>`
        select service_id, cost from service_pause_costs order by service_id, cost`,
      sql<
        {
          id: string;
          service_id: string;
          household_id: string;
          payer_id: string;
          monthly_cost: string;
          billing_cycle: string;
          renews_on: string;
          status: string;
          paused_on: string | null;
          resume_by: string | null;
          last_used_on: string | null;
        }[]
      >`select id, service_id, household_id, payer_id, monthly_cost, billing_cycle,
               renews_on, status, paused_on, resume_by, last_used_on
          from subscriptions order by id`,
      sql<
        {
          id: string;
          name: string;
          release_year: number;
          kind: string;
          planned_month: number;
          offers_observed_at: Date | null;
        }[]
      >`select id, name, release_year, kind, planned_month, offers_observed_at
          from watchlist_titles order by planned_month, id`,
      sql<{ title_id: string; person_id: string }[]>`
        select title_id, person_id from interests order by title_id, person_id`,
      sql<
        {
          title_id: string;
          season_number: number | null;
          service_id: string;
          kind: string;
          price: string | null;
        }[]
      >`select title_id, season_number, service_id, kind, price
          from watchlist_offers order by title_id, season_number nulls first, service_id`,
    ]);

    // The honest empty state. Nobody has imported anything, so there is no
    // private data to get wrong and the demo dataset is what the family sees.
    if (households.length === 0) return demoCatalog();

    const costsByService = new Map<string, string[]>();
    for (const row of pauseCosts) {
      costsByService.set(row.service_id, [...(costsByService.get(row.service_id) ?? []), row.cost]);
    }
    const termsByService = new Map(pauseTerms.map((t) => [t.service_id, t]));

    // Assembled as plain values, not as domain types. The checker below is what
    // turns them into domain types, and handing it something already typed
    // would be asserting exactly what it exists to verify.
    const assembled = {
      country: settings[0]?.country,
      households: households.map((h) => ({ id: h.id, name: h.name, location: h.location })),
      people: people.map((p) => ({ id: p.id, name: p.name, householdId: p.household_id })),
      services: services.map((s) => {
        const terms = termsByService.get(s.id);
        return {
          id: s.id,
          name: s.name,
          monthlyPrice: money(s.monthly_price),
          sharingPolicy: s.sharing_policy,
          ...(s.extra_member_price === null ? {} : { extraMemberPrice: money(s.extra_member_price) }),
          ...(terms
            ? {
                pause: {
                  method: terms.method,
                  manageUrl: terms.manage_url,
                  ...(terms.max_pause_months === null
                    ? {}
                    : { maxPauseMonths: terms.max_pause_months }),
                  costs: costsByService.get(s.id) ?? [],
                  verifiedOn: terms.verified_on,
                },
              }
            : {}),
        };
      }),
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        serviceId: s.service_id,
        householdId: s.household_id,
        payerId: s.payer_id,
        monthlyCost: money(s.monthly_cost),
        billingCycle: s.billing_cycle,
        renewsOn: s.renews_on,
        status: s.status,
        ...(s.paused_on === null ? {} : { pausedOn: s.paused_on }),
        ...(s.resume_by === null ? {} : { resumeBy: s.resume_by }),
        ...(s.last_used_on === null ? {} : { lastUsedOn: s.last_used_on }),
      })),
      titles: titles.map((t) => ({
        id: t.id,
        name: t.name,
        year: t.release_year,
        kind: t.kind,
        plannedMonth: t.planned_month,
      })),
      interests: interests.map((n) => ({ titleId: n.title_id, personId: n.person_id })),
      availability: buildAvailability(titles, offers),
    };

    const family = checkFamilyData(assembled, this.label);
    return {
      source: 'private',
      path: this.label,
      catalog: {
        households: family.households,
        people: family.people,
        services: family.services,
        subscriptions: family.subscriptions,
        titles: family.titles,
        interests: family.interests,
        availability: new MockAvailabilityProvider(family.availability),
        country: family.country,
      },
    };
  }

  /**
   * Pause or resume one subscription.
   *
   * One statement, so the row moves or it does not. The constraints on
   * `subscriptions` carry the same rules the file's checker applies - a paused
   * row says when billing stopped, an active row carries no stale resume date -
   * so a change that would break them is refused by the database and the
   * previous row survives untouched. That is the same guarantee the atomic file
   * write gave, bought differently.
   */
  async setSubscriptionStatus(change: SubscriptionStatusChange): Promise<StatusWriteResult> {
    const loaded = await this.load();

    // Empty database, demo dataset. Writing here would conjure the first
    // household row out of a fixture, and nobody could tell it apart from real
    // data afterwards.
    if (loaded.source === 'demo') {
      const sub = loaded.catalog.subscriptions.find((s) => s.id === change.subscriptionId);
      if (!sub) throw new Error(`No subscription "${change.subscriptionId}" in the demo dataset.`);
      return { source: 'demo', persisted: false, subscription: applyToRow(sub, change) };
    }

    const paused = change.status === 'paused';
    const rows = await this.sql<
      {
        id: string;
        service_id: string;
        household_id: string;
        payer_id: string;
        monthly_cost: string;
        billing_cycle: string;
        renews_on: string;
        status: string;
        paused_on: string | null;
        resume_by: string | null;
        last_used_on: string | null;
      }[]
    >`
      update subscriptions
         set status     = ${paused ? 'paused' : 'active'},
             paused_on  = ${paused ? (change.pausedOn ?? null) : null},
             resume_by  = ${paused ? (change.resumeBy ?? null) : null},
             updated_at = now()
       where id = ${change.subscriptionId}
      returning id, service_id, household_id, payer_id, monthly_cost, billing_cycle,
                renews_on, status, paused_on, resume_by, last_used_on`;

    if (rows.length === 0) {
      throw new Error(`No subscription "${change.subscriptionId}" in this dataset.`);
    }

    const row = rows[0];
    const subscription: Subscription = {
      id: row.id,
      serviceId: row.service_id,
      householdId: row.household_id,
      payerId: row.payer_id,
      monthlyCost: Number(row.monthly_cost),
      billingCycle: row.billing_cycle as Subscription['billingCycle'],
      renewsOn: row.renews_on,
      status: row.status as Subscription['status'],
    };
    if (row.paused_on !== null) subscription.pausedOn = row.paused_on;
    if (row.resume_by !== null) subscription.resumeBy = row.resume_by;
    if (row.last_used_on !== null) subscription.lastUsedOn = row.last_used_on;

    return { source: 'private', persisted: true, subscription };
  }

  /**
   * Record one approved request.
   *
   * The upsert clears `handed_off_at`, which is the interesting half. A second
   * press on the same day reuses the request id by design, and if it changed
   * anything - a resume where a pause stood - the Mac has to see the new
   * version. Leaving the handoff stamp in place would let the old request sit
   * in the queue file as though it were current.
   */
  async queuePauseRequest(request: PauseRequest): Promise<void> {
    await this.sql`
      insert into pause_requests (
        id, subscription_id, service_id, service_name, household_name,
        action, method, manage_url, approved, approved_at, resume_by, notes
      ) values (
        ${request.id}, ${request.subscriptionId}, ${request.serviceId},
        ${request.serviceName}, ${request.householdName}, ${request.action},
        ${request.method}, ${request.manageUrl}, ${request.approved},
        ${request.approvedAt}, ${request.resumeBy ?? null}, ${request.notes ?? null}
      )
      on conflict (id) do update set
        subscription_id = excluded.subscription_id,
        service_id      = excluded.service_id,
        service_name    = excluded.service_name,
        household_name  = excluded.household_name,
        action          = excluded.action,
        method          = excluded.method,
        manage_url      = excluded.manage_url,
        approved        = excluded.approved,
        approved_at     = excluded.approved_at,
        resume_by       = excluded.resume_by,
        notes           = excluded.notes,
        handed_off_at   = null`;
  }

  async pauseSnapshot(): Promise<PauseSnapshot> {
    const [requests, results] = await Promise.all([
      this.sql<
        {
          id: string;
          subscription_id: string;
          service_id: string;
          service_name: string;
          household_name: string;
          action: string;
          method: string;
          manage_url: string;
          approved: boolean;
          approved_at: Date;
          resume_by: string | null;
          notes: string | null;
          handed_off_at: Date | null;
        }[]
      >`select id, subscription_id, service_id, service_name, household_name, action,
               method, manage_url, approved, approved_at, resume_by, notes, handed_off_at
          from pause_requests order by created_at`,
      this.sql<
        {
          request_id: string;
          outcome: string;
          observed_at: Date;
          billing_stops_on: string | null;
          evidence: string | null;
          screenshot: string | null;
        }[]
      >`select request_id, outcome, observed_at, billing_stops_on, evidence, screenshot
          from pause_results order by observed_at, id`,
    ]);

    return {
      requests: requests.map((r): QueuedRequest => {
        const request: PauseRequest = {
          id: r.id,
          subscriptionId: r.subscription_id,
          serviceId: r.service_id,
          serviceName: r.service_name,
          householdName: r.household_name,
          action: r.action as PauseRequest['action'],
          method: r.method as PauseRequest['method'],
          manageUrl: r.manage_url,
          approved: r.approved,
          approvedAt: r.approved_at.toISOString(),
        };
        if (r.resume_by !== null) request.resumeBy = r.resume_by;
        if (r.notes !== null) request.notes = r.notes;
        const handedOffAt = iso(r.handed_off_at);
        return handedOffAt === undefined ? { request } : { request, handedOffAt };
      }),
      results: results.map((r): PauseResult => {
        const result: PauseResult = {
          requestId: r.request_id,
          outcome: r.outcome as PauseResult['outcome'],
          observedAt: r.observed_at.toISOString(),
        };
        const billingStopsOn = skipNull(r.billing_stops_on);
        if (billingStopsOn !== undefined) result.billingStopsOn = billingStopsOn;
        const evidence = skipNull(r.evidence);
        if (evidence !== undefined) result.evidence = evidence;
        const screenshot = skipNull(r.screenshot);
        if (screenshot !== undefined) result.screenshot = screenshot;
        return result;
      }),
    };
  }
}

/**
 * The recorded offers, in the fixture table's shape.
 *
 * Series rows and season rows stay apart here exactly as they do in the schema.
 * Collapsing them would hand the planner a whole-title claim wearing a season's
 * clothes, which is how a rotation plan strands somebody mid-series.
 */
function buildAvailability(
  titles: { id: string; offers_observed_at: Date | null }[],
  offers: {
    title_id: string;
    season_number: number | null;
    service_id: string;
    kind: string;
    price: string | null;
  }[],
): Record<string, unknown> {
  const table: Record<string, unknown> = {};

  for (const row of offers) {
    const entry = (table[row.title_id] ??= {}) as {
      series?: Offer[];
      seasons?: Record<number, Offer[]>;
      observedAt?: string;
    };
    const offer = {
      serviceId: row.service_id,
      kind: row.kind,
      ...(row.price === null ? {} : { price: Number(row.price) }),
    } as Offer;

    if (row.season_number === null) {
      (entry.series ??= []).push(offer);
    } else {
      const seasons = (entry.seasons ??= {});
      (seasons[row.season_number] ??= []).push(offer);
    }
  }

  // Only on titles that have offers. An observedAt with nothing under it says a
  // source answered when none did.
  for (const title of titles) {
    const entry = table[title.id] as { observedAt?: string } | undefined;
    if (entry && title.offers_observed_at) entry.observedAt = title.offers_observed_at.toISOString();
  }

  return table;
}
