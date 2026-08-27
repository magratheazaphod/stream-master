/**
 * The sync job on the Mac. `npm run pause:sync`.
 *
 * This is the third piece `docs/pause-automation.md` calls for. The app is
 * hosted and Cowork is not, and neither can move: Cowork's whole mechanism is
 * Jesse's signed-in Chrome session, and the point of hosting is that his mother
 * opens a URL without asking anyone. So the two halves stopped sharing a disk
 * and something has to stand between them.
 *
 *   Vercel app  ->  Postgres  <->  this script  <->  data/*.json  <->  Cowork
 *
 * It runs here because this is the only machine that can see both the database
 * and the queue file. It is a script and not a route on purpose: a route would
 * need the Mac to be reachable from the internet, which is the arrangement this
 * design exists to avoid.
 *
 * **Cowork's contract does not change and this script is why.** It still reads
 * one file and writes another and it never learns a database exists. Every
 * difference between the two worlds is absorbed here. If a change to this file
 * ever requires a change to `cowork/`, the seam has been put in the wrong place.
 *
 * Two directions, in this order:
 *
 *   1. Pull. Approved requests the Mac has not taken yet go into
 *      `data/pause-queue.json` and are stamped `handed_off_at`, which is what
 *      turns "requested" into "with the agent" on the family's screen.
 *   2. Push. Everything in `data/pause-results.json` goes up. Cowork appends to
 *      that file and never truncates it, so the same result is pushed on every
 *      run and the unique index upstream makes the repeat a no-op.
 *
 * Pull before push, so a run that crashes between them has handed work out
 * rather than lost an answer.
 */

import { join } from 'node:path';
import { writeJsonFile } from '../lib/atomic-write';
import {
  readQueue,
  readResults,
  PAUSE_CONTRACT_VERSION,
  type PauseQueueFile,
  type PauseRequest,
} from '../lib/pause-queue';
import { connect } from '../lib/store/db';
import { describe, repoRoot, requireConnectionString } from './lib/env.mjs';

const queuePath = join(repoRoot, 'data', 'pause-queue.json');
const resultsPath = join(repoRoot, 'data', 'pause-results.json');

const url = requireConnectionString();
// The app's own connector, so a script sees the same values the app does.
// Dates in particular: it keeps them as the ISO days they are, and a Date
// object here would put a timestamp in the queue file Cowork parses.
const sql = connect(url, { max: 1 });

const now = new Date();

try {
  console.log(`Syncing the pause queue with ${describe(url)}`);

  /* -- Pull -------------------------------------------------------------- */

  // Approved only, and the filter lives in SQL rather than in a loop below,
  // because it is the gate the whole arrangement rests on. Cowork skips
  // anything that is not exactly true, but a request that never reaches the
  // file cannot be acted on by mistake in the first place.
  const pending = await sql<
    {
      id: string;
      subscription_id: string;
      service_id: string;
      service_name: string;
      household_name: string;
      action: string;
      method: string;
      manage_url: string;
      approved_at: Date;
      resume_by: string | null;
      notes: string | null;
    }[]
  >`
    select id, subscription_id, service_id, service_name, household_name, action,
           method, manage_url, approved_at, resume_by, notes
      from pause_requests
     where approved and handed_off_at is null
     order by created_at`;

  if (pending.length > 0) {
    const queue: PauseQueueFile = readQueue(queuePath);
    const fresh: PauseRequest[] = pending.map((r) => {
      const request: PauseRequest = {
        id: r.id,
        subscriptionId: r.subscription_id,
        serviceId: r.service_id,
        serviceName: r.service_name,
        householdName: r.household_name,
        action: r.action as PauseRequest['action'],
        method: r.method as PauseRequest['method'],
        manageUrl: r.manage_url,
        // Always true here, and written as a literal rather than copied, so the
        // gate cannot be widened by a column edit upstream.
        approved: true,
        approvedAt: r.approved_at.toISOString(),
      };
      if (r.resume_by !== null) request.resumeBy = r.resume_by;
      if (r.notes !== null) request.notes = r.notes;
      return request;
    });

    // Same rule as the app's own append: an id already in the file is replaced,
    // never duplicated. A queue that tells an agent to cancel the same
    // subscription twice is how a household cancels something twice.
    const ids = new Set(fresh.map((r) => r.id));
    const next: PauseQueueFile = {
      version: PAUSE_CONTRACT_VERSION,
      writtenAt: now.toISOString(),
      requests: [...queue.requests.filter((r) => !ids.has(r.id)), ...fresh],
    };

    // The file lands before the stamp. Stamping first and then failing to write
    // would leave a request marked as handed off to a file that does not carry
    // it, and nothing would ever pick it up again.
    writeJsonFile(queuePath, next);
    await sql`
      update pause_requests
         set handed_off_at = ${now.toISOString()}
       where id = any(${[...ids]}) and handed_off_at is null`;
  }

  /* -- Push -------------------------------------------------------------- */

  const results = readResults(resultsPath);
  let pushed = 0;
  for (const result of results) {
    // A result naming a request the database has never seen is dropped rather
    // than invented. It means a hand-edited file or a queue from before the
    // migration, and manufacturing the request row to hang it off would put a
    // pause in the record that nobody approved.
    const rows = await sql`
      insert into pause_results (
        request_id, outcome, observed_at, billing_stops_on, evidence, screenshot
      )
      select ${result.requestId}, ${result.outcome}, ${result.observedAt},
             ${result.billingStopsOn ?? null}, ${result.evidence ?? null},
             ${result.screenshot ?? null}
       where exists (select 1 from pause_requests where id = ${result.requestId})
      on conflict do nothing
      returning id`;
    pushed += rows.length;
  }

  const orphans = results.length - pushed;
  console.log(
    `Handed ${pending.length} request${pending.length === 1 ? '' : 's'} to Cowork. ` +
      `Pushed ${pushed} new result${pushed === 1 ? '' : 's'} from ${results.length} in the file.`,
  );
  if (orphans > 0 && pushed === 0 && results.length > 0) {
    // Not an error. Cowork never truncates its results file, so a run that
    // pushes nothing usually means nothing new happened.
    console.log('Nothing new to push. Cowork appends to its results file and never trims it.');
  }
} finally {
  await sql.end();
}
