import { getCatalog } from '@/lib/catalog';
import { HORIZON_MONTHS, MONTHS, loadAvailability, rotationPlan } from '@/lib/domain';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const seasonList = (ns: number[]) =>
  ns.length === 1 ? `season ${ns[0]}` : `seasons ${ns.join(', ')}`;

/** A service can also carry no season we could check, which is worse than partial. */
const shortfall = (service: string, carries: number[], missing: number[]) =>
  carries.length === 0
    ? `${service} is listed for the whole title, but no season we could check confirms it.`
    : `${service} carries ${seasonList(carries)}. It does not carry ${seasonList(missing)}.`;

export default async function Plan() {
  const c = getCatalog();
  const snapshot = await loadAvailability(c);
  const plan = rotationPlan(c, snapshot);

  const cellFor = (serviceId: string, month: number) =>
    plan.cells.find((x) => x.serviceId === serviceId && x.month === month);

  return (
    <main>
      <h1>The plan</h1>
      <p className="lede">
        A streaming service is a rental, not a standing cost. This is the calendar of
        which months each service earns its money, driven entirely by what the family
        put on the watchlist.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="label">Paying now, held all year</div>
          <div className="value">{usd(plan.currentAnnual)}</div>
          <div className="sub">every service, every month</div>
        </div>
        <div className="tile">
          <div className="label">Paying on this plan</div>
          <div className="value accent">{usd(plan.plannedAnnual)}</div>
          <div className="sub">only the months with something to watch</div>
        </div>
        <div className="tile">
          <div className="label">Difference</div>
          <div className="value good">{usd(plan.savedAnnual)}</div>
          <div className="sub">
            {Math.round((plan.savedAnnual / plan.currentAnnual) * 100)}% of the current bill
          </div>
        </div>
      </div>

      <h2>When to turn each service on</h2>
      <div className="card scroll" style={{ padding: '14px 16px' }}>
        <table className="grid">
          <thead>
            <tr>
              <th className="svc" />
              {Array.from({ length: HORIZON_MONTHS }, (_, m) => (
                <th key={m}>{MONTHS[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.services.map((s) => (
              <tr key={s.id}>
                <td className="svc strong">{s.name}</td>
                {Array.from({ length: HORIZON_MONTHS }, (_, m) => {
                  const cell = cellFor(s.id, m);
                  const n = cell?.households.length ?? 0;
                  const names = cell
                    ? cell.households
                        .map((h) => c.households.find((x) => x.id === h)!.name)
                        .join(', ')
                    : '';
                  return (
                    <td key={m}>
                      <div
                        className={`cell${n ? ` n${Math.min(n, 4)}` : ''}`}
                        title={
                          cell
                            ? `${s.name}, ${MONTHS[m]} - ${names} (${cell.titles.join(', ')})`
                            : `${s.name}, ${MONTHS[m]} - nobody needs it`
                        }
                      >
                        {n || ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="legend">
          <span>Households that need it that month</span>
          <span className="swatches">
            <i style={{ background: 'var(--gridline)' }} />
            <i style={{ background: 'var(--seq-1)' }} />
            <i style={{ background: 'var(--seq-2)' }} />
            <i style={{ background: 'var(--seq-3)' }} />
            <i style={{ background: 'var(--seq-4)' }} />
          </span>
          <span>none → four</span>
        </div>
      </div>

      <h2>The schedule, written out</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Service</th>
              <th>Households</th>
              <th>For</th>
            </tr>
          </thead>
          <tbody>
            {[...plan.cells]
              .sort((a, b) => a.month - b.month || a.serviceId.localeCompare(b.serviceId))
              .map((cell) => (
                <tr key={`${cell.serviceId}-${cell.month}`}>
                  <td className="strong">{MONTHS[cell.month % 12]}</td>
                  <td>{c.services.find((s) => s.id === cell.serviceId)!.name}</td>
                  <td className="dim">
                    {cell.households
                      .map((h) => c.households.find((x) => x.id === h)!.name)
                      .join(', ')}
                  </td>
                  <td className="dim">{cell.titles.join(', ')}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(plan.partial.length > 0 || plan.unplaced.length > 0) && (
        <>
          <h2>What this plan does not settle</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {plan.partial.map((p) => (
                  <tr key={`${p.title.id}-${p.service.id}`}>
                    <td className="strong">{p.title.name}</td>
                    <td className="dim">
                      <span className="pill unsure">
                        <i className="dot unsure" />
                        runs out mid-series
                      </span>{' '}
                      {shortfall(p.service.name, p.carries, p.missing)}
                    </td>
                  </tr>
                ))}
                {plan.unplaced.map((u) => (
                  <tr key={u.title.id}>
                    <td className="strong">{u.title.name}</td>
                    <td className="dim">
                      <span className="pill unsure">
                        <i className="dot unsure" />
                        not scheduled
                      </span>{' '}
                      {u.reason === 'unknown-availability'
                        ? 'No source could confirm where this streams, so the calendar leaves it out rather than guess.'
                        : 'No subscription carries it. Renting or buying is the only way in.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            A whole-title answer is a union across seasons, so a service can appear to
            carry a show and still drop it after season one. The plan schedules the
            service that carries every season it could check, and says so here when no
            such service exists.
          </p>
        </>
      )}

      <h2>Nobody asked for these</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Paid by</th>
              <th className="num">Costs a year</th>
            </tr>
          </thead>
          <tbody>
            {plan.unjustified.map((u) => (
              <tr key={u.service.id}>
                <td className="strong">{u.service.name}</td>
                <td className="dim">{u.households.map((h) => h.name).join(', ')}</td>
                <td className="num strong">{usd(u.annualCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        The saving assumes the family actually cancels after the month it needs, which
        is the whole risk in this idea. Forgetting to cancel is where the money leaks,
        so the reminder matters more than the calculation.
      </p>
    </main>
  );
}
