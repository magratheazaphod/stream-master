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

/**
 * The three presses, and why the client names which one it means.
 *
 * The server could infer the step from the stored state, but then two people
 * pressing at the same moment would each have their press mean whatever the
 * other's had just made true - the second press would approve a request the
 * first had only just raised. Naming the intent lets a press that no longer
 * matches the state be refused rather than silently promoted.
 */
export type Intent = 'request' | 'approve' | 'withdraw';

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
  let body: { subscriptionId?: string; action?: PauseAction; intent?: Intent };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { subscriptionId, action, intent = 'request' } = body;
  if (!subscriptionId || (action !== 'pause' && action !== 'resume')) {
    return NextResponse.json(
      { error: 'Expected subscriptionId and an action of pause or resume.' },
      { status: 400 },
    );
  }
  if (intent !== 'request' && intent !== 'approve' && intent !== 'withdraw') {
    return NextResponse.json(
      { error: 'Expected an intent of request, approve or withdraw.' },
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

  const flipStatus = () =>
    store.setSubscriptionStatus(
      action === 'pause'
        ? {
            subscriptionId,
            status: 'paused',
            pausedOn: today,
            resumeBy: resumeByFor(sub, service.pause, now),
          }
        : { subscriptionId, status: 'active' },
    );

  const stateNow = async () => pauseStateFrom(subscriptionId, await store.pauseSnapshot());

  // Never queue against the demo dataset. Its households are invented, but the
  // services are real, and a queued request naming Netflix would send Cowork to
  // cancel somebody's actual Netflix on the strength of a fixture. With nothing
  // queued there is no request to approve, so the demo keeps the single press it
  // always had and says so rather than miming a rule it cannot run.
  if (source === 'demo') {
    const written = await flipStatus();
    const response: ToggleResponse = {
      subscription: written.subscription,
      persisted: false,
      pause: { progress: 'none' },
      queueNote:
        'Demo data. Nothing was saved and nothing was queued, so this change lasts as long as the tab does, and no second household is asked.',
    };
    return NextResponse.json(response);
  }

  // Who is pressing. Required at every step, because the rule is that two
  // different households were involved and an anonymous press cannot be counted
  // as either of them. Attribution and not proof: everybody shares one password,
  // so this stops a slip rather than a determined person.
  const viewer = resolvePerson((await cookies()).get(PERSON_COOKIE)?.value, catalog.people);
  const viewerHousehold = viewer
    ? catalog.households.find((h) => h.id === viewer.householdId)
    : undefined;
  if (!viewer || !viewerHousehold) {
    return NextResponse.json(
      {
        error:
          'Say who you are first. Stopping or restarting a subscription takes two households, so the app has to know which one you are in.',
      },
      { status: 403 },
    );
  }

  const state = await stateNow();

  if (intent === 'withdraw') {
    const live = state.request;
    if (!live || (state.progress !== 'awaiting-approval' && state.progress !== 'requested')) {
      return NextResponse.json(
        {
          error:
            state.progress === 'in-flight'
              ? 'An agent already has this one. It cannot be called back from here.'
              : 'There is nothing waiting to be taken back.',
        },
        { status: 409 },
      );
    }

    // Order matters. Drop the request first: if the status write then fails, the
    // family is looking at a state nobody can act on, which is recoverable. The
    // reverse leaves an approved request in the queue against a row that says
    // nothing is happening, and an agent acts on the queue.
    await store.withdrawPauseRequest(live.id);
    // Only an approved request ever moved the row, so only that one moves it back.
    const written =
      state.progress === 'requested'
        ? await store.setSubscriptionStatus(
            action === 'pause'
              ? { subscriptionId, status: 'active' }
              : { subscriptionId, status: 'paused', pausedOn: today },
          )
        : { subscription: sub, persisted: true as const };
    return NextResponse.json({
      subscription: written.subscription,
      persisted: true,
      pause: await stateNow(),
    } satisfies ToggleResponse);
  }

  if (intent === 'approve') {
    const live = state.request;
    if (!live || state.progress !== 'awaiting-approval') {
      return NextResponse.json(
        { error: 'There is no request waiting for a second household on this one.' },
        { status: 409 },
      );
    }
    if (!live.requestedHousehold) {
      return NextResponse.json(
        {
          error:
            'This request was raised before the app recorded which household asked, so it cannot be checked against a second one. Take it back and raise it again.',
        },
        { status: 409 },
      );
    }
    if (live.requestedHousehold === viewerHousehold.name) {
      return NextResponse.json(
        {
          error: `${live.requestedHousehold} asked for this. Somebody from another household has to agree before anything happens.`,
        },
        { status: 403 },
      );
    }

    const approved: PauseRequest = {
      ...live,
      approved: true,
      approvedAt: now.toISOString(),
      approvedBy: viewer.name,
      approvedHousehold: viewerHousehold.name,
    };

    // The request goes through the gate before the row moves. An approved
    // request against an unchanged row is a job an agent can do; a moved row
    // with no approved request is a screen claiming something nobody queued.
    await store.queuePauseRequest(approved);
    let written;
    try {
      written = await flipStatus();
    } catch (e) {
      return NextResponse.json(
        { error: `The change was not saved. ${(e as Error).message}` },
        { status: 500 },
      );
    }
    return NextResponse.json({
      subscription: written.subscription,
      persisted: written.persisted,
      pause: await stateNow(),
    } satisfies ToggleResponse);
  }

  /* intent === 'request' */

  if (state.progress === 'awaiting-approval' || state.progress === 'requested' || state.progress === 'in-flight') {
    return NextResponse.json(
      { error: 'Something is already under way on this one.' },
      { status: 409 },
    );
  }

  // No recorded terms means nobody has walked this provider's stop-billing flow,
  // so there is no URL to send an agent to and nothing to put in a request. The
  // two-household rule needs a request to hold the pending state, so a service
  // in this position keeps the single press it always had, and the row says the
  // app cannot send anybody.
  if (!service.pause) {
    const written = await flipStatus();
    return NextResponse.json({
      subscription: written.subscription,
      persisted: written.persisted,
      pause: { progress: 'none' },
      queueNote: `Nobody has walked ${service.name}'s flow, so nothing was queued and no second household was asked. Somebody has to stop this one by hand.`,
    } satisfies ToggleResponse);
  }

  const queued: PauseRequest = {
    id: requestId(today, service.id, household.name),
    subscriptionId,
    serviceId: service.id,
    serviceName: service.name,
    householdName: household.name,
    action,
    method: service.pause.method,
    manageUrl: service.pause.manageUrl,
    // Not approved, and that is the whole point. `pause-sync` pulls only
    // approved rows, so this is invisible to Cowork until a second household
    // agrees. The press is a proposal now, not a decision.
    approved: false,
    requestedBy: viewer.name,
    requestedHousehold: viewerHousehold.name,
  };
  if (action === 'pause') {
    queued.resumeBy = resumeByFor(sub, service.pause, now);
  }
  if (service.pause.costs.length > 0) {
    queued.notes = `Pausing gives up: ${service.pause.costs.join(', ')}.`;
  }

  try {
    await store.queuePauseRequest(queued);
  } catch (e) {
    return NextResponse.json(
      { error: `Nothing was recorded. ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // The row does not move. Nothing has been decided, and a status that changed
  // on one press would have the screen show a pause the family has not agreed to.
  return NextResponse.json({
    subscription: sub,
    persisted: true,
    pause: await stateNow(),
  } satisfies ToggleResponse);
}
