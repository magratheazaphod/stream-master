'use client';

import { useState } from 'react';
import type { PauseProgress } from '@/lib/pause-queue';
import type { DatasetSource } from '@/lib/catalog';
import type { BillingStopsAt, PauseCost, PauseMethod, SubscriptionStatus } from '@/lib/types';

/** One subscription, flattened for the client. Everything the row renders. */
export interface Row {
  id: string;
  serviceName: string;
  householdName: string;
  payerName: string;
  monthlyCost: number;
  status: SubscriptionStatus;
  resumeBy?: string;
  /** How far a queued pause got. `none` means nothing was ever asked of Cowork. */
  progress: PauseProgress;
  /** The confirmation text an agent actually read. Only a confirmed pause has one. */
  evidence?: string;
  /** False when nobody has walked this provider's stop-billing flow. */
  hasTerms: boolean;
  pauseCosts: PauseCost[];
  /** How this provider stops billing. Absent when nobody has walked the flow. */
  pauseMethod?: PauseMethod;
  /** Ceiling on a native pause, in months. Native pause only. */
  maxPauseMonths?: number;
  /** When the money stops. Absent is unknown, and the screen then says nothing. */
  billingStopsAt?: BillingStopsAt;
  /** True when the person picked on this browser is the payer. Ordering only. */
  mine?: boolean;
  /** Who asked for the pause, where anybody said who they were. */
  approvedBy?: string;
  /** Who raised the request, and from which household. The rule turns on the household. */
  requestedBy?: string;
  requestedHousehold?: string;
  /**
   * What the live request is about.
   *
   * Not derivable from `status`. A pause waiting on a second household leaves the
   * row reading active, and an approved pause leaves it reading paused - so
   * deriving the action from the status would send "resume" when undoing a
   * pause, and the undo would set the row the wrong way.
   */
  pendingAction?: 'pause' | 'resume';
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const COST_LABEL: Record<PauseCost, string> = {
  downloads: 'downloads go',
  'watch-list': 'the saved list goes',
  profiles: 'profiles and their history go',
  'grandfathered-price': 'coming back costs more',
  'annual-term-forfeit': 'the rest of the annual term is forfeit',
};

/**
 * What the screen may say about one row, and it is the strictest thing here.
 *
 * The app records intent. Cowork executes. Only a `confirmed` result - done, with
 * the confirmation text the agent read - earns the word stopped. Everything else
 * says requested, blocked or failed, because the whole product rests on never
 * telling a family they saved money they did not save.
 */
/**
 * What the button says, and it is not cosmetic.
 *
 * A native pause and a cancellation are different acts with different costs, and
 * the old screen called both of them "Turn off". Hulu can genuinely suspend
 * billing and hand the account back untouched; Netflix has no pause at all, so
 * stopping means cancelling and coming back means re-subscribing, at whatever
 * price is on sale that day. Offering one word for both invites somebody to
 * cancel a subscription believing they parked it.
 */
function actionLabel(row: Row): string {
  if (row.status === 'paused') {
    switch (row.pauseMethod) {
      case 'native-pause':
        return 'Resume';
      case 'cancel-resubscribe':
        return 'Re-subscribe';
      default:
        return 'Turn back on';
    }
  }
  switch (row.pauseMethod) {
    case 'native-pause':
      return 'Pause';
    case 'cancel-resubscribe':
      return 'Cancel';
    case 'store-managed':
      return 'Cancel in the store';
    default:
      return 'Turn off';
  }
}

/**
 * The sentence under an active row that says what the button will actually do.
 *
 * Every clause here comes from a walkthrough somebody wrote down, never from the
 * method name. `maxPauseMonths` is quoted as a floor rather than a ceiling
 * because that is how it is recorded: Hulu's real limit is 12 weeks and the
 * model counts whole months, so the stored 2 deliberately understates it. Saying
 * "at least" keeps the app on the safe side of a date the provider must honour.
 */
function whatTheButtonDoes(row: Row): string | null {
  if (row.status !== 'active' || !row.hasTerms) return null;

  const when =
    row.billingStopsAt === 'next-billing-date'
      ? 'Billing stops at the next billing date, not today, so this keeps working until then.'
      : row.billingStopsAt === 'immediately'
        ? 'Billing stops straight away.'
        : null;

  switch (row.pauseMethod) {
    case 'native-pause': {
      const ceiling = row.maxPauseMonths
        ? ` The account survives, and it comes back on its own after at least ${row.maxPauseMonths} ${row.maxPauseMonths === 1 ? 'month' : 'months'}.`
        : ' The account survives.';
      return `${when ?? 'A real pause, not a cancellation.'}${ceiling}`;
    }
    case 'cancel-resubscribe':
      return `${row.serviceName} sells no pause, so this cancels. Coming back means re-subscribing at whatever the price is then.${when ? ` ${when}` : ''}`;
    case 'store-managed':
      return `Billed through a store, so an agent stops it from the store account rather than from ${row.serviceName}.${when ? ` ${when}` : ''}`;
    default:
      return null;
  }
}

/**
 * What this viewer's press will do, given where the request has got to.
 *
 * Three presses and never two, because the middle one is the whole feature: one
 * household proposes, a different household agrees, and only then is there
 * anything an agent could act on. `null` means this viewer has no press to make
 * and the button is not offered - a request cannot be approved by the household
 * that raised it, and nothing can be called back once an agent holds it.
 */
type Press =
  | { intent: 'request'; label: string }
  | { intent: 'approve'; label: string }
  | { intent: 'withdraw'; label: string };

function pressFor(row: Row, viewerHousehold: string | undefined): Press | null {
  if (row.progress === 'awaiting-approval') {
    // The household that asked may take it back. Anybody else may agree to it.
    if (!viewerHousehold) return null;
    if (row.requestedHousehold === viewerHousehold) {
      return { intent: 'withdraw', label: 'Take the request back' };
    }
    return { intent: 'approve', label: `Approve, and ${verb(row).toLowerCase()}` };
  }

  // Approved and nobody has taken it yet. This is the undo window, and it closes
  // the moment the sync job hands the job to an agent.
  if (row.progress === 'requested') {
    return { intent: 'withdraw', label: `${gerund(row)} - tap to undo` };
  }

  // In flight, or finished, or blocked. Nothing for a button to do.
  if (row.progress === 'in-flight' || row.progress === 'confirmed') return null;

  return { intent: 'request', label: actionLabel(row) };
}

/** The verb for what is being asked, in the row's own vocabulary. */
function verb(row: Row): string {
  return actionLabel(row);
}

/** The same act, in progress. */
function gerund(row: Row): string {
  if (row.status === 'paused') return 'Restarting';
  switch (row.pauseMethod) {
    case 'native-pause':
      return 'Pausing';
    case 'cancel-resubscribe':
    case 'store-managed':
      return 'Cancelling';
    default:
      return 'Stopping';
  }
}

function statusPill(row: Row) {
  if (row.status === 'active') {
    return <span className="pill covered"><i className="dot good" />Live</span>;
  }
  switch (row.progress) {
    case 'confirmed':
      return <span className="pill covered"><i className="dot good" />Billing stopped</span>;
    // Two states, not one, and the difference is a machine. A request lives in
    // the database until the sync job on Jesse's Mac picks it up, and if the Mac
    // is asleep it lives there for hours. Saying "with the agent" while nothing
    // can see it would imply somebody is standing by when nobody is.
    case 'awaiting-approval':
      return (
        <span className="pill unsure">
          <i className="dot unsure" />Waiting on a second household
        </span>
      );
    case 'requested':
      return <span className="pill unsure"><i className="dot unsure" />Requested, not picked up</span>;
    case 'in-flight':
      return <span className="pill unsure"><i className="dot unsure" />With the agent</span>;
    case 'unconfirmed':
      return <span className="pill unsure"><i className="dot unsure" />Reported done, no evidence</span>;
    case 'needs-a-person':
      return <span className="pill gap"><i className="dot bad" />Blocked, needs a person</span>;
    case 'failed':
      return <span className="pill gap"><i className="dot bad" />Cowork could not finish it</span>;
    default:
      return <span className="pill unsure"><i className="dot unsure" />Paused in our record only</span>;
  }
}

export function Subscriptions({
  initialRows,
  dataset,
  viewerName,
  viewerHousehold,
}: {
  initialRows: Row[];
  dataset: DatasetSource;
  /** The person picked on this browser, if anybody was. Ordering and wording. */
  viewerName?: string;
  /** The viewer's household. Approval turns on it, so the button text does too. */
  viewerHousehold?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: Row, press: Press) {
    // A live request already says what it is about. Only a fresh proposal reads
    // the action off the row, and only then is the row's status the right source.
    const action = row.pendingAction ?? (row.status === 'active' ? 'pause' : 'resume');
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId: row.id, action, intent: press.intent }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'The change was not saved.');
        return;
      }
      setRows((current) =>
        current.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: body.subscription.status ?? 'active',
                resumeBy: body.subscription.resumeBy,
                progress: body.pause.progress,
                evidence: body.pause.result?.evidence,
                approvedBy: body.pause.request?.approvedBy,
                requestedBy: body.pause.request?.requestedBy,
                requestedHousehold: body.pause.request?.requestedHousehold,
                pendingAction: body.pause.request?.action,
              }
            : r,
        ),
      );
      setNotes((current) => ({ ...current, [row.id]: body.queueNote ?? '' }));
    } catch {
      setError('The app could not reach its own write route, so nothing changed.');
    } finally {
      setBusy(null);
    }
  }

  const billing = rows.filter((r) => r.status === 'active');
  const monthly = billing.reduce((sum, r) => sum + r.monthlyCost, 0);
  // Paused rows Cowork has not confirmed. Real money is still leaving the account
  // for these, so they are named separately rather than netted off the headline.
  const unconfirmed = rows.filter((r) => r.status === 'paused' && r.progress !== 'confirmed');
  const unconfirmedTotal = unconfirmed.reduce((sum, r) => sum + r.monthlyCost, 0);

  return (
    <section>
      <div className="tiles">
        <div className="tile">
          <div className="label">Live now, per month</div>
          <div className="value">{usd(monthly)}</div>
          <div className="sub">
            {usd(monthly * 12)} a year across {billing.length} subscriptions
          </div>
        </div>
        <div className="tile">
          <div className="label">Paused, not yet confirmed</div>
          <div className="value">{usd(unconfirmedTotal)}</div>
          <div className="sub">
            {unconfirmed.length === 0
              ? 'Nothing waiting on a confirmation'
              : `${unconfirmed.length} still billing until Cowork reports back`}
          </div>
        </div>
      </div>

      {dataset === 'demo' && (
        <p className="note">
          Demo data. The toggles work for as long as this tab is open, and nothing is
          written to disk or queued for Cowork. Put a real{' '}
          <code>data/family.json</code> in place to make them stick.
        </p>
      )}

      {error && <p className="note bad-text">{error}</p>}

      {/* Ordering, never filtering. Four households share one screen on purpose,
          and hiding another household's spend behind the person picker would be
          a different product. Yours comes first; everybody's is still here. */}
      <h2>{viewerName ? 'Every subscription, yours first' : 'Every subscription'}</h2>
      <div className="queue">
        {rows.map((row) => (
          <div className="card row" key={row.id}>
            <div className="row-main">
              <div className="row-head">
                <span className="strong">{row.serviceName}</span>
                <span className="dim">
                  {row.householdName}, paid by {row.payerName}
                </span>
                {row.mine && <span className="pill mine">You pay for this</span>}
                {statusPill(row)}
              </div>
              {row.status === 'paused' && row.resumeBy && (
                <div className="because dim">Due back {row.resumeBy}</div>
              )}
              {row.progress === 'awaiting-approval' && (
                <div className="because dim">
                  {row.requestedBy ?? 'Somebody'}
                  {row.requestedHousehold ? ` of ${row.requestedHousehold}` : ''} asked for
                  this.{' '}
                  {!viewerHousehold
                    ? 'Say who you are to agree to it or take it back.'
                    : row.requestedHousehold === viewerHousehold
                      ? 'Somebody from another household has to agree before anything happens.'
                      : 'Nothing has been sent anywhere yet. Agreeing is what starts it.'}
                </div>
              )}
              {row.progress === 'requested' && (
                <div className="because dim">
                  Waiting for the Mac that runs the agent. Nothing happens until it wakes
                  up and takes the job.
                </div>
              )}
              {row.status === 'paused' && row.approvedBy && (
                <div className="because dim">Asked for by {row.approvedBy}.</div>
              )}
              {row.status === 'paused' && row.evidence && (
                <div className="because dim">{row.evidence}</div>
              )}
              {whatTheButtonDoes(row) && (
                <div className="because dim">{whatTheButtonDoes(row)}</div>
              )}
              {row.status === 'active' && row.pauseCosts.length > 0 && (
                <div className="cost">
                  Pausing costs you: {row.pauseCosts.map((c) => COST_LABEL[c]).join(', ')}.
                </div>
              )}
              {!row.hasTerms && (
                <div className="cost warn">
                  Nobody has walked this provider&apos;s stop-billing flow, so the app can
                  record the decision but cannot send anybody to do it.
                </div>
              )}
              {notes[row.id] && <div className="cost warn">{notes[row.id]}</div>}
            </div>
            <div className="row-act">
              <div className="saving">
                {usd(row.monthlyCost)}
                <span className="dim"> /mo</span>
              </div>
              {(() => {
                const press = pressFor(row, viewerHousehold);
                if (!press) return null;
                if (!viewerHousehold && press.intent === 'request') {
                  return (
                    <span className="dim">Pick who you are to change this</span>
                  );
                }
                return (
                  <button
                    type="button"
                    className={`btn ${press.intent === 'request' && row.status === 'active' ? '' : 'off'}`}
                    onClick={() => toggle(row, press)}
                    disabled={busy === row.id}
                  >
                    {busy === row.id ? 'Working' : press.label}
                  </button>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      <p className="note">
        Stopping or restarting a subscription takes two households. One asks, somebody
        from a different household agrees, and only then is the job queued for Claude
        Cowork, which walks the provider&apos;s flow in a signed-in browser. Until an
        agent picks it up you can still take it back. Nothing here reads as stopped
        until Cowork comes back with the confirmation it read on the page.
      </p>
      <p className="note">
        The rule is there to stop a slip, not a person: everybody shares one password
        and the name you pick is the name you chose, so it records who said they
        pressed the button rather than who provably did.
      </p>
    </section>
  );
}
