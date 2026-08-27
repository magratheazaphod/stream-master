'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IDENTITY_CAVEAT } from '@/lib/identity';
import type { Person } from '@/lib/types';

export interface PickerGroup {
  household: { id: string; name: string };
  members: { id: string; name: string }[];
}

/**
 * The person picker.
 *
 * It asks once, after the password, and then gets out of the way. The password
 * is the gate; this is a label. The caveat below is not decoration - anybody
 * holding the shared password can pick any name here, and the interface has to
 * say so in the same breath as it asks, or it implies a check it does not make.
 *
 * Nothing on any screen is hidden by the answer. Shared visibility across the
 * four households is the product.
 */
export function WhoAreYou({
  groups,
  current,
  answered,
}: {
  groups: PickerGroup[];
  current?: Pick<Person, 'id' | 'name'>;
  /** True once this browser has either picked somebody or skipped. */
  answered: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(personId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/person', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? 'That did not save.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('The app could not reach its own route, so nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  /** Forget the answer entirely, so the question comes back. */
  async function forget() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/person', { method: 'DELETE' });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const asking = !answered || open;

  if (!asking) {
    return (
      <p className="whoami">
        {current ? (
          <>
            <span className="strong">You are {current.name}.</span> Your own subscriptions come
            first, and you can see everybody else&apos;s below them.
          </>
        ) : (
          <span className="strong">Nobody is named on this browser.</span>
        )}{' '}
        <button type="button" className="linkish" onClick={() => setOpen(true)} disabled={busy}>
          {current ? 'Not you?' : 'Say who you are'}
        </button>
      </p>
    );
  }

  return (
    <section className="card picker">
      <h2>Who is this?</h2>
      <p className="note">{IDENTITY_CAVEAT} It changes what the app puts first, and who a pause
        is recorded against. It does not lock anything.</p>

      {groups.map((group) => (
        <div className="picker-group" key={group.household.id}>
          <div className="picker-household">{group.household.name}</div>
          <div className="picker-names">
            {group.members.map((person) => (
              <button
                key={person.id}
                type="button"
                className={`btn ${current?.id === person.id ? '' : 'off'}`}
                onClick={() => choose(person.id)}
                disabled={busy}
              >
                {person.name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {error && <p className="note bad-text">{error}</p>}

      <p className="picker-skip">
        <button type="button" className="linkish" onClick={() => choose(null)} disabled={busy}>
          Skip, I would rather not say
        </button>
        {answered && (
          <>
            {' '}
            <button type="button" className="linkish" onClick={forget} disabled={busy}>
              Forget me on this browser
            </button>
          </>
        )}
      </p>
    </section>
  );
}
