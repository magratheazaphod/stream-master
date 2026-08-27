'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Lookup, LookupTitle } from '@/lib/show-lookup';
import type { Suggestions } from '@/app/api/lookup/suggest/route';

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

  const [suggestions, setSuggestions] = useState<LookupTitle[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** Set when TMDB declined the search. Never rendered as "no such show". */
  const [suggestFailed, setSuggestFailed] = useState(false);

  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  /** The text the open list describes. Guards against a stale response landing. */
  const wantedRef = useRef('');

  /**
   * Fetch suggestions for what has been typed so far.
   *
   * Debounced, because a request per keystroke is the thing that would put the
   * TMDB budget at risk, and aborted on the next keystroke so a slow response
   * for "sev" cannot arrive after "severance" and repopulate the list with the
   * wrong thing.
   */
  useEffect(() => {
    const typed = query.trim();
    wantedRef.current = typed;
    // Mirrors MIN_SUGGEST_QUERY, which is the authority - the endpoint returns an
    // empty list below it regardless. Repeated here only to save the round trip,
    // rather than importing the lookup module into the browser bundle.
    if (typed.length < 2) {
      setSuggestions([]);
      setSuggestFailed(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup/suggest?q=${encodeURIComponent(typed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as Suggestions;
        if (wantedRef.current !== typed) return;
        if (body.status === 'unknown') {
          // A source that did not answer is not a source that said no.
          setSuggestFailed(true);
          setSuggestions([]);
          return;
        }
        setSuggestFailed(false);
        setSuggestions(body.suggestions);
        setActive(-1);
        if (body.suggestions.length > 0) setOpen(true);
      } catch {
        // An abort is the normal case here, and a network failure leaves the
        // list as it was rather than asserting anything about the title.
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // A click outside closes the list. Escape does too, from the keyboard.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function run(url: string) {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url);
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

  /**
   * Ask about a title the person picked.
   *
   * The id goes with it, so the answer is about the row they clicked rather than
   * about whatever their half-typed text would have resolved to.
   */
  function choose(title: LookupTitle) {
    setQuery(title.name);
    wantedRef.current = title.name;
    setSuggestions([]);
    void run(
      `/api/lookup?tmdbId=${title.tmdbId}&kind=${title.kind}` +
        `&name=${encodeURIComponent(title.name)}${title.year ? `&year=${title.year}` : ''}`,
    );
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim() === '') return;
    // Enter on a highlighted row means that row, not the typed text.
    if (open && active >= 0 && suggestions[active]) {
      choose(suggestions[active]);
      return;
    }
    void run(`/api/lookup?q=${encodeURIComponent(query)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const next = i + step;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
    }
  }

  return (
    <section>
      <h2>Can we watch it</h2>
      <form className="ask" onSubmit={ask}>
        <div className="combo" ref={boxRef}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Name a show or a film"
            aria-label="Name a show or a film"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
          />
          {open && suggestions.length > 0 && (
            <ul className="combo-list" id={listId} role="listbox">
              {suggestions.map((t, i) => (
                <li
                  key={`${t.kind}-${t.tmdbId}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`combo-item${i === active ? ' active' : ''}`}
                  // Mouse down rather than click: blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="strong">{t.name}</span>
                  <span className="dim">
                    {t.year ? `${t.year}, ` : ''}
                    {t.kind === 'series' ? 'series' : 'film'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="btn" disabled={busy || query.trim() === ''}>
          {busy ? 'Asking' : 'Ask'}
        </button>
      </form>
      {suggestFailed && (
        <p className="note">
          TMDB is not answering the search, so there are no suggestions to show. That is a
          gap in the source, not a sign the title does not exist - asking still works.
        </p>
      )}
      {error && <p className="note bad-text">{error}</p>}
      {answer && <Answer answer={answer} />}
    </section>
  );
}
