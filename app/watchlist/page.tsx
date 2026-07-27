import { getCatalog } from '@/lib/catalog';
import { MONTHS, loadAvailability, rankedWatchlist } from '@/lib/domain';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const kindLabel: Record<string, string> = {
  flatrate: 'subscribe',
  rent: 'rent',
  buy: 'buy',
};

const seasonList = (ns: number[]) =>
  ns.length === 0 ? 'none' : ns.length === 1 ? `season ${ns[0]}` : `seasons ${ns.join(', ')}`;

export default async function Watchlist() {
  const c = getCatalog();
  const snapshot = await loadAvailability(c);
  const list = rankedWatchlist(c, snapshot);
  const maxWant = Math.max(...list.map((v) => v.interestCount), 1);

  return (
    <main>
      <h1>The shared watchlist</h1>
      <p className="lede">
        Anyone can add a title. The list ranks by how many people want it, so the
        family can see where its attention actually clusters, and what it would cost to
        get there.
      </p>

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Wanted by</th>
              <th>Planned</th>
              <th>Where it stands</th>
              <th>Cheapest way in</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.title.id}>
                <td>
                  <div className="strong">{v.title.name}</div>
                  <div className="dim" style={{ fontSize: 12.5 }}>
                    {v.title.year} · {v.title.kind}
                  </div>
                </td>
                <td>
                  <div className="wants">
                    <span className="meter" aria-hidden="true">
                      {Array.from({ length: maxWant }, (_, i) => (
                        <i key={i} className={i < v.interestCount ? '' : 'off'} />
                      ))}
                    </span>
                    <span className="strong">{v.interestCount}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {v.wantedBy.map((p) => p.name).join(', ')}
                  </div>
                </td>
                <td className="dim">{MONTHS[v.title.plannedMonth % 12]}</td>
                <td>
                  {v.unknownFor.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <span className="pill unsure">
                        <i className="dot unsure" />
                        not confirmed
                      </span>{' '}
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        for {v.unknownFor.map((p) => p.name).join(', ')}
                      </span>
                    </div>
                  )}
                  {v.coveredFor.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <span className="pill covered">
                        <i className="dot good" />
                        {v.coveringServices.map((s) => s.name).join(' / ')}
                      </span>{' '}
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        covers {v.coveredFor.map((p) => p.name).join(', ')}
                      </span>
                    </div>
                  )}
                  {v.uncoveredFor.length > 0 && (
                    <div>
                      <span className="pill gap">
                        <i className="dot bad" />
                        not covered
                      </span>{' '}
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        for {v.uncoveredFor.map((p) => p.name).join(', ')}
                      </span>
                    </div>
                  )}
                  {v.discrepancies
                    .filter((d) => d.kind !== 'season-only')
                    .map((d) => (
                      <div
                        key={d.serviceId}
                        className="dim"
                        style={{ fontSize: 12.5, marginTop: 4 }}
                      >
                        {c.services.find((s) => s.id === d.serviceId)!.name}{' '}
                        {d.kind === 'series-only'
                          ? 'is listed for the series but for no season we could check'
                          : `carries ${seasonList(d.carries)}, not ${seasonList(d.missing)}`}
                      </div>
                    ))}
                  {v.unresolvedSeasons.length > 0 && (
                    <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {seasonList(v.unresolvedSeasons)} came back blank
                    </div>
                  )}
                </td>
                <td>
                  {v.status === 'unknown' ? (
                    <span className="dim">Nothing confirmed yet</span>
                  ) : v.status === 'unavailable' ? (
                    <span className="dim">Nothing carries it</span>
                  ) : v.uncoveredFor.length === 0 ? (
                    <span className="dim">Nothing to buy</span>
                  ) : v.cheapest ? (
                    <>
                      <div className="strong">
                        {kindLabel[v.cheapest.kind]} {v.cheapest.service.name}{' '}
                        {usd(v.cheapest.cost!)}
                        {v.cheapest.kind === 'flatrate' && '/mo'}
                      </div>
                      {v.options.length > 1 && (
                        <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>
                          also{' '}
                          {v.options
                            .filter((o) => o !== v.cheapest)
                            .map((o) =>
                              o.cost === undefined
                                ? `${kindLabel[o.kind]} ${o.service.name} (price unknown)`
                                : `${kindLabel[o.kind]} ${o.service.name} ${usd(o.cost)}`,
                            )
                            .join(' · ')}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="dim">No priced offer</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        Coverage is judged per household, because a subscription one household pays
        for does not help anyone in another. Prices marked unknown are the gap a free availability
        feed leaves: it names the provider without quoting the rental price. Not
        confirmed means the source had nothing to say about a title, which is not the
        same as nothing carrying it, and the list will never pretend otherwise.
      </p>
    </main>
  );
}
