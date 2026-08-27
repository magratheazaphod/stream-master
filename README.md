# stream-master

A tool to help my extended family manage our streaming subscriptions: spend less,
know what we're paying for, and figure out the cheapest way to watch the things we
actually want to watch.

## Where real data goes

This repository is public. It holds the shape of the problem, never anybody's
instance of it. The committed dataset in `lib/demo-data.ts` is invented down to the
last household, and the app renders it whenever nothing else is present.

Real family data lives in Postgres, or in `data/family.json` outside version
control. `git` ignores everything under `data/` except the example, so the private
file cannot reach a commit by accident. Copy `data/family.example.json`, fill it in
and reload, then `npm run db:import` when it is ready to go up.

Three outcomes, and only three, and they hold on both stores. No private data gives
the demo dataset. Private data that checks out gives the real one. Private data that
is malformed, partial or internally inconsistent throws on load, naming every fault,
and the app never falls back. Silent fallback is the failure worth engineering against, because a reader who
cannot tell the two datasets apart eventually publishes the wrong one. For the same
reason the masthead states which dataset is loaded on every page.

## The one number

Combined family spend per month. Every feature below either lowers it or gets cut.
The specific waste this product attacks is the long idle hold: a service nobody
watches for five months because turning it off is annoying and nobody is watching the
renewal date.

## Pause, not cancel

The product's verb is **pause**. A household stops paying for a service now and
expects to come back to it later, which is a different promise from quitting. That
distinction drives the design:

- A subscription has a state, not a lifecycle. Paused is a state on a row that stays
  in the inventory with its history and its spend record.
- Pausing carries a cost the app has to show before the press. Where a provider has
  no native pause, stopping means cancelling, and cancelling can lose downloads, a
  profile, a watch list or a grandfathered price. That is the honest number next to
  the dollars saved.
- Resume cannot be an afterthought. If the plan says Max comes back in April, the app
  owns that date, because a pause the family forgets to lift is how somebody loses a
  show mid-season and stops trusting the tool.

## Priorities

**P0 - pause a subscription in one press.** Stopping a service is deliberately hard on
every provider's site, and the whole thesis dies if it costs ten minutes of
dark-pattern navigation. The app holds the pause path for each service, queues the
stops this month calls for and walks the payer through them in one pass.

**P0 - the idle-service alarm.** Name the services the family is paying for and not
using, with the dollars already sunk and the next renewal date. This is the thing
that makes anyone press the button, and it needs no external data.

**P0 - shared inventory.** Cost, billing cycle, renewal date, payer, household. The
substrate the other two stand on.

**P1 - discovery on what we already pay for.** Given the services the family holds,
surface what is on them that nobody has thought of. This runs the availability seam
backwards: not "where can I watch X" but "what is worth watching on what we already
bought". Scoped to the service about to be dropped and the current month, so it
informs the pause decision rather than manufacturing reasons to keep everything.

**P0 - the resume date.** Every pause records when the service is due back, and the
app raises it before the family needs it. Cheap to build and it is what makes pausing
safe enough to do repeatedly.

**P1 - the rotation plan.** One household carries a service for the months the family
needs it. This is where the savings get scheduled instead of improvised.

**P2 - resume in one press.** The reminder is P0, the button is not. Providers make
subscribing easy, so a link and a nudge covers it until they don't.

**P2 - "where can I watch X?"** A lookup, not a savings lever. It survives as the
demand input to the rotation plan, not as its own screen.

**Cut - account management.** Profiles, screen limits and who holds which login save
nobody any money. Out until the spend number moves.

**Cut - annual-versus-monthly optimization and plan downgrades.** Real savings, small
savings, and an annual plan is a bet against ever rotating. Revisit after two
rotations complete.

## How pausing actually works

A minority of services sell a real pause, where billing stops and the account, the
profiles and the watch list survive. Everywhere else, pause means cancel and
resubscribe, and the app should say so rather than pretend the two are the same. Part
of the first build is walking the six services the family holds and recording which
kind each one is.

No major streamer sells a public API for either. Anyone promising one button is
choosing one of three mechanisms, and the choice is the product decision:

- **Assisted pause.** The app stores the exact pause or cancel URL per service, opens
  it, and records the subscription as paused when the payer confirms. Ships now, needs
  no credentials, covers every service. It is one press in stream-master and two or
  three on the provider's page. This is the P0.
- **Agentic pause.** Drive the provider's site with the member's session and click
  through for them. Genuinely one press, and rejected. It needs stored credentials,
  it breaks whenever a provider moves a button, and several providers' terms forbid
  it. The no-credentials line stands.
- **Billing consolidation.** Services bought as Amazon Prime Video Channels, Apple TV
  Channels or Roku subscriptions stop from one account the household already
  controls. This is the only path where one press is literal, and it costs a
  migration: each household re-buys its services through one storefront. Worth
  proposing per household once the assisted flow proves the family will rotate.

## Status

Prototype runs against fixtures: family landscape, shared watchlist and a rotation
plan. Stack settled - Next.js and TypeScript, PWA, Postgres on Supabase, Google
sign-in only. Multiple households with shared visibility and no row-level security.
Availability lives behind a vendor-neutral seam in `lib/types.ts`, with TMDB the
leading source.

## Open questions

- Which pause flows to hand-map first. The URLs are stable enough to hard-code but
  somebody has to walk each one, record it and note whether the service offers a real
  pause. The first pass covers the six services the family actually holds.
- Whether discovery pulls from TMDB discover by watch provider, which is free and
  gives provider-scoped catalogues directly, or from a paid feed with better
  transactional pricing.
- How to rank discovery results for a family rather than a person. Interest overlap
  across eight people is the signal worth using, and it is not what any provider's
  own recommender optimizes.
- What a pause costs on each service beyond the money. Lost downloads, a wiped watch
  list or a price the household will not get back are the reasons somebody refuses to
  press the button, and the app has to know them per service to be honest.
- How to detect an idle service without viewing history. Nobody is ingesting watch
  data, so the first version asks the family directly and the question has to be
  cheap enough to answer monthly.
