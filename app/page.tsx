import { cookies } from 'next/headers';
import { hasAnswered, peopleByHousehold, resolvePerson, PERSON_COOKIE } from '@/lib/identity';
import { getStore } from '@/lib/store';
import { pauseStateFrom } from '@/lib/store/pause-state';
import { AddToCatalog } from './components/AddToCatalog';
import { ShowLookup } from './components/ShowLookup';
import { Subscriptions, type Row } from './components/Subscriptions';
import { WhoAreYou } from './components/WhoAreYou';

/** The dataset and the pause queue both change under the app. Read every request. */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const store = getStore();
  const { catalog, source } = await store.load();
  const snapshot = await store.pauseSnapshot();

  // Who is looking. Identity and not authentication: the shared password already
  // decided who gets in, and this only decides what comes first and whose name a
  // pause is recorded against. An unrecognised cookie resolves to nobody, which
  // is the everyone-view and works exactly as it did before.
  const cookie = (await cookies()).get(PERSON_COOKIE)?.value;
  const viewer = resolvePerson(cookie, catalog.people);
  // The household, not just the name. Approval turns on which household somebody
  // is in, so the screen has to know before it can say what a press will do.
  const viewerHousehold = viewer
    ? catalog.households.find((h) => h.id === viewer.householdId)
    : undefined;

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
      // Absent stays absent, so the row can tell "nobody walked this flow" from
      // "the flow was walked and this is what it does".
      if (service.pause) row.pauseMethod = service.pause.method;
      if (service.pause?.maxPauseMonths !== undefined) {
        row.maxPauseMonths = service.pause.maxPauseMonths;
      }
      if (service.pause?.billingStopsAt !== undefined) {
        row.billingStopsAt = service.pause.billingStopsAt;
      }
      if (viewer && sub.payerId === viewer.id) row.mine = true;
      if (sub.resumeBy) row.resumeBy = sub.resumeBy;
      if (state.result?.evidence) row.evidence = state.result.evidence;
      if (state.request?.approvedBy) row.approvedBy = state.request.approvedBy;
      if (state.request?.requestedBy) row.requestedBy = state.request.requestedBy;
      if (state.request?.requestedHousehold) {
        row.requestedHousehold = state.request.requestedHousehold;
      }
      // Only while something is live. A finished request must not leave a stale
      // action behind for the next press to pick up.
      if (
        state.request &&
        (state.progress === 'awaiting-approval' || state.progress === 'requested')
      ) {
        row.pendingAction = state.request.action;
      }
      return row;
    })
    // The viewer's own rows lead. Everything else follows, still on the same
    // screen: shared visibility across the households is the feature.
    .sort(
      (a, b) =>
        Number(b.mine ?? false) - Number(a.mine ?? false) ||
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

      <WhoAreYou
        groups={peopleByHousehold(catalog.people, catalog.households)}
        answered={hasAnswered(cookie)}
        {...(viewer ? { current: { id: viewer.id, name: viewer.name } } : {})}
      />

      <Subscriptions
        initialRows={rows}
        dataset={source}
        {...(viewer ? { viewerName: viewer.name } : {})}
        {...(viewerHousehold ? { viewerHousehold: viewerHousehold.name } : {})}
      />

      <AddToCatalog
        households={catalog.households.map((h) => ({ id: h.id, name: h.name }))}
        people={catalog.people.map((p) => ({ id: p.id, name: p.name, householdId: p.householdId }))}
        services={[...catalog.services]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name }))}
        canWrite={source === 'private'}
        {...(viewer ? { defaultHouseholdId: viewer.householdId, defaultPayerId: viewer.id } : {})}
      />

      <ShowLookup />
    </main>
  );
}
