'use client';

import { useState } from 'react';
import type { Lookup } from '@/lib/show-lookup';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Join names the way the writing standard requires: "A, B and C", never an
 * Oxford comma and never a chain of "and"s.
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The caveat, and it is not optional on a TV answer.
 *
 * TMDB's series-level provider data is a union across every season. It reports
 * Netflix for NCIS while Netflix holds 2 of the 23 seasons. Roughly one series in
 * five carries a real mid-series split, so an answer built on the union can
 * strand somebody in the middle of a run. Season-level checking is the next
 * stage of the integration; until it lands this sentence is the honest version.
 */
function SeasonCaveat() {
  return (
    <p className="note">
      This answer covers the series as a whole. Providers often carry only part of a
      long-running show, and about one series in five splits mid-run, so check the
      season you want before you buy anything.
    </p>
  );
}

/** TMDB's terms require both credits, and the provider data requires JustWatch. */
function Attribution({ link }: { link?: string }) {
  return (
    <p className="note attribution">
      Title and availability data from TMDB. This product uses the TMDB API but is not
      endorsed or certified by TMDB. Streaming availability supplied by JustWatch
      {link ? (
        <>
          {' '}
          -{' '}
          <a href={link} target="_blank" rel="noreferrer">
            see the full list
          </a>
        </>
      ) : null}
      .
    </p>
  );
}

function Answer({ answer }: { answer: Lookup }) {
  if (answer.status === 'no-match') {
    return (
      <div className="card verdict">
        <h3>Nothing came back for that</h3>
        <p className="because dim">
          TMDB found no title matching &ldquo;{answer.query}&rdquo;. Try the full name, or
          the original-language one.
        </p>
      </div>
    );
  }

  // Unknown is a fact about the source, never about the title. The screen keeps
  // the two apart, because "we could not find out" and "nobody carries it" lead
  // to opposite decisions.
  if (answer.status === 'unknown') {
    return (
      <div className="card verdict">
        <h3>
          <span className="pill unsure">
            <i className="dot unsure" />
            Unknown
          </span>{' '}
          {answer.title?.name ?? answer.query}
        </h3>
        <p className="because dim">
          {answer.reason}. That is a gap in the data, not a sign nobody carries it.
        </p>
      </div>
    );
  }

  const { title } = answer;
  const named = `${title.name}${title.year ? ` (${title.year})` : ''}`;

  if (answer.status === 'unavailable') {
    return (
      <div className="card verdict">
        <h3>
          <span className="pill gap">
            <i className="dot bad" />
            Nowhere
          </span>{' '}
          {named}
        </h3>
        <p className="because dim">
          TMDB answered and listed no US provider at all, to stream, rent or buy.
        </p>
        {title.kind === 'series' && <SeasonCaveat />}
        <Attribution link={answer.justwatchLink} />
      </div>
    );
  }

  if (answer.status === 'have-it') {
    return (
      <div className="card verdict">
        <h3>
          <span className="pill covered">
            <i className="dot good" />
            You have it
          </span>{' '}
          {named}
        </h3>
        <ul className="plain">
          {answer.heldBy.map((h) => (
            <li key={h.service.id}>
              <span className="strong">{h.service.name}</span>, paid for by{' '}
              {joinNames(h.households.map((x) => x.name))}
            </li>
          ))}
        </ul>
        {answer.alsoOn.length > 0 && (
          <p className="because dim">Also carried by {answer.alsoOn.join(', ')}.</p>
        )}
        {title.kind === 'series' && <SeasonCaveat />}
        <Attribution link={answer.justwatchLink} />
      </div>
    );
  }

  const cheapest = answer.paths[0];
  return (
    <div className="card verdict">
      <h3>
        <span className="pill gap">
          <i className="dot bad" />
          Not on anything you pay for
        </span>{' '}
        {named}
      </h3>

      {cheapest ? (
        <>
          <p className="because">
            Cheapest way in: <span className="strong">{cheapest.service.name}</span> at{' '}
            <span className="strong">{usd(cheapest.monthlyCost)}</span> a month.{' '}
            {cheapest.because}.
          </p>
          {answer.paths.length > 1 && (
            <ul className="plain">
              {answer.paths.slice(1).map((p) => (
                <li key={p.service.id}>
                  {p.service.name}, {usd(p.monthlyCost)} a month
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="because dim">
          Nothing carrying it is a service the family has a price for.
        </p>
      )}

      {answer.unpriced.length > 0 && (
        <p className="because dim">
          Also on {answer.unpriced.join(', ')}, which the family holds no price for.
        </p>
      )}
      {answer.rentOrBuyOn.length > 0 && (
        <p className="because dim">
          Rentable or buyable from {answer.rentOrBuyOn.join(', ')}. TMDB publishes no
          price for those, so none is shown.
        </p>
      )}

      {title.kind === 'series' && <SeasonCaveat />}
      <Attribution link={answer.justwatchLink} />
    </div>
  );
}

export function ShowLookup() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        setError('The lookup failed. Nothing is known either way.');
        setAnswer(null);
        return;
      }
      setAnswer((await res.json()) as Lookup);
    } catch {
      setError('The lookup failed. Nothing is known either way.');
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Can we watch it</h2>
      <form className="ask" onSubmit={ask}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name a show or a film"
          aria-label="Name a show or a film"
        />
        <button type="submit" className="btn" disabled={busy || query.trim() === ''}>
          {busy ? 'Asking' : 'Ask'}
        </button>
      </form>
      {error && <p className="note bad-text">{error}</p>}
      {answer && <Answer answer={answer} />}
    </section>
  );
}
