import { getStore } from '@/lib/store';
import { pauseStateFrom } from '@/lib/store/pause-state';
import { ShowLookup } from './components/ShowLookup';
import { Subscriptions, type Row } from './components/Subscriptions';

/** The dataset and the pause queue both change under the app. Read every request. */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const store = getStore();
  const { catalog, source } = await store.load();
  const snapshot = await store.pauseSnapshot();

  const rows: Row[] = catalog.subscriptions
    .map((sub) => {
      const service = catalog.services.find((s) => s.id === sub.serviceId)!;
      const household = catalog.households.find((h) => h.id === sub.householdId)!;
      const payer = catalog.people.find((p) => p.id === sub.payerId)!;
      const state = pauseStateFrom(sub.id, snapshot);
      const row: Row = {
        id: sub.id,
        serviceName: service.name,
        householdName: household.name,
        payerName: payer.name,
        monthlyCost: sub.monthlyCost,
        status: sub.status ?? 'active',
        progress: state.progress,
        hasTerms: service.pause !== undefined,
        pauseCosts: service.pause?.costs ?? [],
      };
      if (sub.resumeBy) row.resumeBy = sub.resumeBy;
      if (state.result?.evidence) row.evidence = state.result.evidence;
      return row;
    })
    .sort(
      (a, b) =>
        a.serviceName.localeCompare(b.serviceName) ||
        a.householdName.localeCompare(b.householdName),
    );

  return (
    <main>
      <h1>What the family is paying for</h1>
      <p className="lede">
        Every subscription across {catalog.households.length} households. Turn one off
        and the app records it and sends an agent to go and do it. Ask about a show and
        it says whether you already have it.
      </p>

      <Subscriptions initialRows={rows} dataset={source} />
      <ShowLookup />
    </main>
  );
}
