/**
 * The toggle's write path.
 *
 * Two things happen here and they are not the same thing. The app records the
 * family's intent in its own dataset, and it queues a request for Claude Cowork,
 * which is the only thing on either side of this seam that can actually stop a
 * bill. The response says which of the two succeeded, separately, because the
 * screen is not allowed to imply the second from the first.
 */

import { NextResponse } from 'next/server';
import { loadCatalog, setSubscriptionStatus, FAMILY_DATA_PATH } from '@/lib/catalog';
import { EPHEMERAL_WRITE_MESSAGE, isEphemeralFilesystem } from '@/lib/deployment';
import {
  appendRequest,
  pauseStateFor,
  readQueue,
  readResults,
  requestId,
  type PauseRequest,
  type PauseState,
} from '@/lib/pause-queue';
import type { PauseAction } from '@/lib/pause-queue';
import type { Subscription } from '@/lib/types';

/** The dataset is a file on disk, so nothing on this route may be cached. */
export const dynamic = 'force-dynamic';

/**
 * How long a pause runs before the app asks for it back.
 *
 * The app owns this date rather than leaving it open, because a pause nobody
 * lifts is how a household loses a show mid-season, and that failure costs more
 * trust than the subscription costs money. A provider that sells a shorter
 * native pause wins: promising four months on a two-month pause is a promise the
 * provider will break on the family's behalf.
 */
const DEFAULT_PAUSE_MONTHS = 3;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

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

  const { catalog, source } = loadCatalog();
  const sub = catalog.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) {
    return NextResponse.json({ error: `No subscription "${subscriptionId}".` }, { status: 404 });
  }

  // Refuse before writing, not after failing. On Vercel the bundle is read-only
  // and /tmp does not outlive the instance, so every store this route touches is
  // a store that forgets. Say that plainly rather than let the family read a
  // filesystem error, or worse, watch the button do nothing.
  if (isEphemeralFilesystem()) {
    return NextResponse.json({ error: EPHEMERAL_WRITE_MESSAGE }, { status: 503 });
  }

  const service = catalog.services.find((s) => s.id === sub.serviceId)!;
  const household = catalog.households.find((h) => h.id === sub.householdId)!;
  const now = new Date();
  const today = iso(now);

  let written;
  try {
    written = setSubscriptionStatus(
      action === 'pause'
        ? {
            subscriptionId,
            status: 'paused',
            pausedOn: today,
            resumeBy: iso(addMonths(now, service.pause?.maxPauseMonths ?? DEFAULT_PAUSE_MONTHS)),
          }
        : { subscriptionId, status: 'active' },
      FAMILY_DATA_PATH,
    );
  } catch (e) {
    // The write refused, which means the file on disk is untouched. Say so: a
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
  if (action === 'pause' && written.subscription.resumeBy) {
    queued.resumeBy = written.subscription.resumeBy;
  }
  if (service.pause.costs.length > 0) {
    queued.notes = `Pausing gives up: ${service.pause.costs.join(', ')}.`;
  }

  let queueNote: string | undefined;
  try {
    appendRequest(queued, undefined, now);
  } catch (e) {
    queueNote = `The change is recorded, but the queue was not written: ${(e as Error).message}`;
  }

  const response: ToggleResponse = {
    subscription: written.subscription,
    persisted: written.persisted,
    pause: queueNote
      ? { progress: 'none' }
      : pauseStateFor(subscriptionId, readQueue(), readResults()),
    ...(queueNote ? { queueNote } : {}),
  };
  return NextResponse.json(response);
}
