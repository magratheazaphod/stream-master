'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Kind = 'subscription' | 'service' | 'person' | 'household';

export interface AddOptions {
  households: { id: string; name: string }[];
  people: { id: string; name: string; householdId: string }[];
  services: { id: string; name: string }[];
  /** False on the demo dataset, which is a fixture and cannot be added to. */
  canWrite: boolean;
  /** What the current person's own household and name should preselect. */
  defaultHouseholdId?: string;
  defaultPayerId?: string;
}

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'subscription', label: 'A subscription' },
  { kind: 'service', label: 'A service' },
  { kind: 'person', label: 'A person' },
  { kind: 'household', label: 'A household' },
];

/**
 * Adding to the family's data from the screen.
 *
 * Four small forms behind one disclosure, because the least technical user is
 * the one who matters and a page that opens with four forms on it has already
 * lost her. Every field is either a list to choose from or one value to type.
 *
 * Two things this form deliberately does not do. It never asks for pause terms:
 * a service added here has no walked stop-billing flow, so it gets none, and the
 * app then offers no pause button for it and says why. And it does no client-side
 * validation beyond `required`, because the server checks the whole dataset with
 * the same checker the private file goes through, and a second set of rules here
 * would be the set that drifts.
 */
export function AddToCatalog(options: AddOptions) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('subscription');
  const [busy, setBusy] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { kind, ...Object.fromEntries(new FormData(form)) };
    setBusy(true);
    setFaults([]);
    setDone(null);
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { error?: string; faults?: string[] };
      if (!res.ok) {
        setFaults(payload.faults ?? [payload.error ?? 'Nothing was saved.']);
        return;
      }
      form.reset();
      setDone('Saved. It is in the list below.');
      router.refresh();
    } catch {
      setFaults(['The app could not reach its own write route, so nothing was saved.']);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p className="whoami">
        <button type="button" className="linkish" onClick={() => setOpen(true)}>
          Add a subscription, a service, a person or a household
        </button>
      </p>
    );
  }

  return (
    <section className="card adder">
      <div className="adder-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            className={`btn ${kind === tab.kind ? '' : 'off'}`}
            onClick={() => {
              setKind(tab.kind);
              setFaults([]);
              setDone(null);
            }}
          >
            {tab.label}
          </button>
        ))}
        <button type="button" className="linkish" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {!options.canWrite && (
        <p className="note bad-text">
          This copy is running on demo data, which is a fixture built into the app. Nothing
          added here can be saved.
        </p>
      )}

      <form onSubmit={submit} className="adder-form">
        {kind === 'subscription' && (
          <>
            <label className="field">
              <span>Which service</span>
              <select name="serviceId" required defaultValue="">
                <option value="" disabled>
                  Choose one
                </option>
                {options.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Which household pays</span>
              <select name="householdId" required defaultValue={options.defaultHouseholdId ?? ''}>
                <option value="" disabled>
                  Choose one
                </option>
                {options.households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Who pays it</span>
              <select name="payerId" required defaultValue={options.defaultPayerId ?? ''}>
                <option value="" disabled>
                  Choose one
                </option>
                {options.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cost per month</span>
              <input name="monthlyCost" required placeholder="12.99" inputMode="decimal" />
            </label>
            <label className="field">
              <span>Billed</span>
              <select name="billingCycle" defaultValue="monthly">
                <option value="monthly">monthly</option>
                <option value="annual">annually</option>
              </select>
            </label>
            <label className="field">
              <span>Next renewal</span>
              <input name="renewsOn" required placeholder="2026-09-01" />
            </label>
          </>
        )}

        {kind === 'service' && (
          <>
            <label className="field">
              <span>Name</span>
              <input name="name" required placeholder="Britbox" />
            </label>
            <label className="field">
              <span>List price per month</span>
              <input name="monthlyPrice" required placeholder="8.99" inputMode="decimal" />
            </label>
            <label className="field">
              <span>Who may share it</span>
              <select name="sharingPolicy" defaultValue="household-only">
                <option value="household-only">one household only</option>
                <option value="extra-member">an extra member can be bought</option>
                <option value="two-adults">two adults, any address</option>
              </select>
            </label>
            <label className="field">
              <span>Extra-member price, if there is one</span>
              <input name="extraMemberPrice" placeholder="leave blank if none" inputMode="decimal" />
            </label>
            <p className="cost warn">
              A service added here gets no pause button. Nobody has walked its stop-billing
              flow, so the app has no page to send an agent to and will not guess at one.
            </p>
          </>
        )}

        {kind === 'person' && (
          <>
            <label className="field">
              <span>Name</span>
              <input name="name" required placeholder="Peter" />
            </label>
            <label className="field">
              <span>Household</span>
              <select name="householdId" required defaultValue={options.defaultHouseholdId ?? ''}>
                <option value="" disabled>
                  Choose one
                </option>
                {options.households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {kind === 'household' && (
          <>
            <label className="field">
              <span>What to call it</span>
              <input name="name" required placeholder="Fairhaven" />
            </label>
            <label className="field">
              <span>Where it is</span>
              <input name="location" required placeholder="Portland, OR" />
            </label>
            <label className="field">
              <span>First person in it</span>
              <input name="firstPersonName" required placeholder="Peter" />
            </label>
          </>
        )}

        <div className="adder-act">
          <button type="submit" className="btn" disabled={busy || !options.canWrite}>
            {busy ? 'Saving' : 'Save'}
          </button>
          {done && <span className="cost good">{done}</span>}
        </div>
      </form>

      {faults.length > 0 && (
        <ul className="note bad-text">
          {faults.map((fault) => (
            <li key={fault}>{fault}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
