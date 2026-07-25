import { getCatalog } from '@/lib/catalog';
import { rankedWatchlist } from '@/lib/domain';
import { MONTHS } from '@/lib/mock-data';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const kindLabel: Record<string, string> = {
  flatrate: 'subscribe',
  rent: 'rent',
  buy: 'buy',
};

export default function Watchlist() {
  const c = getCatalog();
  const list = rankedWatchlist(c);
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
                </td>
                <td>
                  {v.uncoveredFor.length === 0 ? (
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
        Coverage is judged per household, because a subscription in Chicago does not
        help anyone in Boston. Prices marked unknown are the gap a free availability
        feed leaves: it names the provider without quoting the rental price.
      </p>
    </main>
  );
}
