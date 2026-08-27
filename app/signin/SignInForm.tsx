'use client';

import { useState } from 'react';

/**
 * One field, one button. There are no accounts here, so there is nothing to
 * choose, nothing to recover and nothing to remember except the password the
 * family already shares.
 */
export function SignInForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        // A full navigation, not a router push: the new cookie has to be on the
        // request that renders the page behind the gate.
        window.location.assign(next);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Sign-in failed. Try again.');
    } catch {
      setError('The network dropped the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <h1>Family password</h1>
        <p className="lede">
          This page shows what four households pay and who pays it. One password covers everyone.
        </p>
        <label className="signin-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="signin-input"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p className="signin-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn" type="submit" disabled={busy || password === ''}>
          {busy ? 'Checking' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
