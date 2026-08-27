/**
 * The toggle's write path.
 *
 * Two things happen here and they are not the same thing. The app records the
 * family's intent in its own dataset, and it queues a request for Claude Cowork,
 * which is the only thing on either side of this seam that can actually stop a
 * bill. The response says which of the two succeeded, separately, because the
 * screen is not allowed to imply the second from the first.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { PERSON_COOKIE, resolvePerson } from '@/lib/identity';
import { getStore } from '@/lib/store';
import { pauseStateFrom } from '@/lib/store/pause-state';
import { EPHEMERAL_WRITE_MESSAGE, isEphemeralFilesystem } from '@/lib/deployment';
import { hasDatabase } from '@/lib/store/db';
import { requestId, type PauseRequest, type PauseState } from '@/lib/pause-queue';
import type { PauseAction } from '@/lib/pause-queue';
import type { Subscription } from '@/lib/types';
import { isoDay, resumeByFor } from '@/lib/pause-dates';

/** The dataset changes under the app, so nothing on this route may be cached. */
export const dynamic = 'force-dynamic';

export interface ToggleResponse {
  subscription: Subscription;
  /** False on the demo dataset, which is read-only by design. */
  persisted: boolean;
  /** Present when a request reached the queue. Absent means nothing was queued. */
  pause: PauseState;
  /** Why nothing was queued, where nothing was. Rendered, never swallowed. */
  queueNote?: string;
}

export async function POST(request: Request) {
  let body: { subscriptionId?: string; action?: PauseAction };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { subscriptionId, action } = body;
  if (!subscriptionId || (action !== 'pause' && action !== 'resume')) {
    return NextResponse.json(
      { error: 'Expected subscriptionId and an action of pause or resume.' },
      { status: 400 },
    );
  }

  const store = getStore();
  const { catalog, source } = await store.load();
  const sub = catalog.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) {
    return NextResponse.json({ error: `No subscription "${subscriptionId}".` }, { status: 404 });
  }

  // Refuse before writing, not after failing. A hosted deployment with no
  // database configured has nowhere to put this: the bundle is read-only and
  // /tmp does not outlive the instance, so every store it could reach is a store
  // that forgets. Say that plainly rather than let the family read a filesystem
  // error, or worse, watch the button do nothing. With Postgres configured this
  // no longer fires, which is the whole point of the migration.
  if (isEphemeralFilesystem() && !hasDatabase()) {
    return NextResponse.json({ error: EPHEMERAL_WRITE_MESSAGE }, { status: 503 });
  }

  const service = catalog.services.find((s) => s.id === sub.serviceId)!;
  const household = catalog.households.find((h) => h.id === sub.householdId)!;
  const now = new Date();
  const today = isoDay(now);

  let written;
  try {
    written = await store.setSubscriptionStatus(
      action === 'pause'
        ? {
            subscriptionId,
            status: 'paused',
            pausedOn: today,
            resumeBy: resumeByFor(sub, service.pause, now),
          }
        : { subscriptionId, status: 'active' },
    );
  } catch (e) {
    // The write refused, which means the stored row is untouched. Say so: a
    // silent failure here would leave the screen showing a pause that is not
    // recorded anywhere.
    return NextResponse.json(
      { error: `The change was not saved. ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // Never queue against the demo dataset. Its households are invented, but the
  // services are real, and a queued request naming Netflix would send Cowork to
  // cancel somebody's actual Netflix on the strength of a fixture.
  if (source === 'demo') {
    const response: ToggleResponse = {
      subscription: written.subscription,
      persisted: false,
      pause: { progress: 'none' },
      queueNote:
        'Demo data. Nothing was saved and nothing was queued, so this change lasts as long as the tab does.',
    };
    return NextResponse.json(response);
  }

  // No recorded terms means nobody has walked this provider's stop-billing flow,
  // so there is no URL to send an agent to. Queueing a guess would point a
  // browser at the wrong page on a real account.
  if (!service.pause) {
    const response: ToggleResponse = {
      subscription: written.subscription,
      persisted: written.persisted,
      pause: { progress: 'none' },
      queueNote: `Nobody has walked ${service.name}'s flow, so nothing was queued. Somebody has to stop this one by hand.`,
    };
    return NextResponse.json(response);
  }

  const id = requestId(today, service.id, household.name);
  const queued: PauseRequest = {
    id,
    subscriptionId,
    serviceId: service.id,
    serviceName: service.name,
    householdName: household.name,
    action,
    method: service.pause.method,
    manageUrl: service.pause.manageUrl,
    // The press is the approval. Cowork runs unattended and skips anything that
    // is not exactly true, which is what keeps a scheduled run from cancelling
    // something nobody chose to cancel.
    approved: true,
    approvedAt: now.toISOString(),
  };
  // Who said yes, where anybody said who they were. Attribution and not proof -
  // everybody shares one password - but a cancellation an unattended agent
  // executes should carry a name rather than an anonymous true. Absent when the
  // person picker was skipped, and absent is honest.
  const approver = resolvePerson((await cookies()).get(PERSON_COOKIE)?.value, catalog.people);
  if (approver) queued.approvedBy = approver.name;
  if (action === 'pause' && written.subscription.resumeBy) {
    queued.resumeBy = written.subscription.resumeBy;
  }
  if (service.pause.costs.length > 0) {
    queued.notes = `Pausing gives up: ${service.pause.costs.join(', ')}.`;
  }

  let queueNote: string | undefined;
  try {
    await store.queuePauseRequest(queued);
  } catch (e) {
    queueNote = `The change is recorded, but the queue was not written: ${(e as Error).message}`;
  }

  const response: ToggleResponse = {
    subscription: written.subscription,
    persisted: written.persisted,
    pause: queueNote
      ? { progress: 'none' }
      : pauseStateFrom(subscriptionId, await store.pauseSnapshot()),
    ...(queueNote ? { queueNote } : {}),
  };
  return NextResponse.json(response);
}
