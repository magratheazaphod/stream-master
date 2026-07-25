import { getCatalog } from '@/lib/catalog';
import {
  currentMonthlySpend,
  duplicates,
  localDate,
  rotationPlan,
  upcomingRenewals,
} from '@/lib/domain';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const sharingLabel: Record<string, string> = {
  'household-only': 'One household',
  'extra-member': 'Extra member sold',
  'two-adults': 'Two adults',
};

export default function Landscape() {
  const c = getCatalog();
  const monthly = currentMonthlySpend(c);
  const dupes = duplicates(c);
  const plan = rotationPlan(c);
  const renewals = upcomingRenewals(c, new Date('2026-07-25'), 30);

  const rows = c.subscriptions
    .map((sub) => ({
      sub,
      service: c.services.find((s) => s.id === sub.serviceId)!,
      household: c.households.find((h) => h.id === sub.householdId)!,
      payer: c.people.find((p) => p.id === sub.payerId)!,
    }))
    .sort(
      (a, b) =>
        a.service.name.localeCompare(b.service.name) ||
        a.household.name.localeCompare(b.household.name),
    );

  return (
    <main>
      <h1>The landscape</h1>
      <p className="lede">
        Every subscription across {c.households.length} households, in one place. Nobody
        could see this before, which is why the same services get paid for twice.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="label">Combined monthly spend</div>
          <div className="value">{usd(monthly)}</div>
          <div className="sub">{usd(monthly * 12)} a year</div>
        </div>
        <div className="tile">
          <div className="label">Services paid for twice or more</div>
          <div className="value">{dupes.length}</div>
          <div className="sub">
            {usd(dupes.reduce((s, d) => s + d.redundantMonthly, 0))} a month in copies
          </div>
        </div>
        <div className="tile">
          <div className="label">Nobody has asked to watch</div>
          <div className="value">{plan.unjustified.length}</div>
          <div className="sub">
            services with no title on the watchlist
          </div>
        </div>
        <div className="tile">
          <div className="label">Renews in the next 30 days</div>
          <div className="value">{renewals.length}</div>
          <div className="sub">
            {renewals[0]
              ? `next: ${renewals[0].service.name}, ${renewals[0].on.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : 'nothing due'}
          </div>
        </div>
      </div>

      <h2>Every subscription</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Household</th>
              <th>Paid by</th>
              <th>Billing</th>
              <th className="num">Per month</th>
              <th>Renews</th>
              <th>Sharing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sub, service, household, payer }) => {
              const duplicated = dupes.some((d) => d.service.id === service.id);
              return (
                <tr key={sub.id}>
                  <td className="strong">
                    {service.name}
                    {duplicated && (
                      <>
                        {' '}
                        <span className="pill gap">
                          <i className="dot bad" />
                          also elsewhere
                        </span>
                      </>
                    )}
                  </td>
                  <td>{household.name}</td>
                  <td className="dim">{payer.name}</td>
                  <td className="dim">
                    {sub.billingCycle === 'annual' ? 'Annual' : 'Monthly'}
                  </td>
                  <td className="num strong">{usd(sub.monthlyCost)}</td>
                  <td className="dim">
                    {localDate(sub.renewsOn).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="dim">{sharingLabel[service.sharingPolicy]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Paid for more than once</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Households paying</th>
              <th className="num">Cost of the copies</th>
            </tr>
          </thead>
          <tbody>
            {dupes.map((d) => (
              <tr key={d.service.id}>
                <td className="strong">{d.service.name}</td>
                <td className="dim">
                  {d.households.map((h) => h.name).join(', ')}
                </td>
                <td className="num strong">{usd(d.redundantMonthly)}/mo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Paying twice is not automatically waste, because two households cannot watch on
        one account where the provider enforces a single household. It becomes waste
        when the two households want the service in different months. The plan settles
        that.
      </p>
    </main>
  );
}
