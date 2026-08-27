'use client';

import { useState } from 'react';
import type { PauseProgress } from '@/lib/pause-queue';
import type { DatasetSource } from '@/lib/catalog';
import type { PauseCost, SubscriptionStatus } from '@/lib/types';

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
  /** True when the person picked on this browser is the payer. Ordering only. */
  mine?: boolean;
  /** Who asked for the pause, where anybody said who they were. */
  approvedBy?: string;
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
}: {
  initialRows: Row[];
  dataset: DatasetSource;
  /** The person picked on this browser, if anybody was. Ordering and wording. */
  viewerName?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: Row) {
    const action = row.status === 'active' ? 'pause' : 'resume';
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId: row.id, action }),
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
              <button
                type="button"
                className={`btn ${row.status === 'active' ? '' : 'off'}`}
                onClick={() => toggle(row)}
                disabled={busy === row.id}
              >
                {busy === row.id
                  ? 'Working'
                  : row.status === 'active'
                    ? 'Turn off'
                    : 'Turn back on'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="note">
        Turning a subscription off records the decision and queues the job for Claude
        Cowork, which walks the provider&apos;s flow in a signed-in browser. Nothing here
        reads as stopped until Cowork comes back with the confirmation it read on the
        page.
      </p>
    </section>
  );
}
