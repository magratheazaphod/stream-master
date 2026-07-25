# Submission

## The problem I chose

Eight people in my extended family, spread across four households, pay for streaming
separately and have no idea what the others already carry. Two households pay for
Max so one person can finish one show. Somebody renews Paramount+ annually a month
after the season they wanted ended. Nobody is being careless; the information simply
does not exist anywhere.

The obvious fix - share one login - is dead. Netflix, Disney+ and most majors now
enforce household boundaries by IP and device. A product built on password sharing
would break within a month and take the family's trust with it. So stream-master
bets on the play that still works: **sequencing**. Services are month-to-month
commodities. If one household carries Max in March and another carries it in June,
and the family knows who is carrying what, the same viewing costs materially less
without anyone violating a terms of service. That is the product.

## One-page PRD

- **Problem / who it's for:** Six to eight technically comfortable adults in one
  extended family, across multiple households and their own devices. They pay for
  overlapping streaming services, cannot see each other's subscriptions and cannot
  legally share logins. They need a combined coverage picture - the tessellation -
  before they can cut anything.

- **What it does (and explicitly what's out of scope):** Each member enters the
  subscriptions they hold with price, billing cycle and renewal date. The app
  assembles the family-wide view, flags duplicate coverage and gaps, and proposes a
  rotation schedule that hands each service to one household at a time. Every service
  carries a flag for the sharing the provider actually permits, so no recommendation
  crosses a household line the provider enforces. Out of scope by decision, not by
  backlog: no credential storage and no login brokering, ever; no row-level security,
  because 6-8 close relatives seeing who pays for what is the feature; no billing,
  payment splitting or settlement between households; no viewing-history ingestion or
  recommendation engine; no design for scale past a few dozen users and a few hundred
  rows a year.

- **How it couples to the demand plan:** Directly. The tessellation is the supply
  side; what the family intends to watch next quarter is the demand side, and the
  rotation schedule is where they meet. Today the demand plan is implicit - it lives
  in group chats about what everyone wants to start. The first build captures supply
  and cost only. Availability data ("which service carries show X") is what turns a
  wish list into a schedule, and it is the one feature needing an external source.
  TMDB watch providers is the leading candidate: free, JustWatch-sourced, title-level
  only. Watchmode is the paid fallback that adds rental and purchase pricing. That
  call is open, and inventory ships before it closes.

- **How a human and the agent co-work:** A member delegates by entering their own
  subscriptions and saying what they want to watch next. The agent returns a
  concrete proposal - drop these two duplicates, move Max to the Chicago household in
  April, hold Apple TV+ through the season finale - with the monthly delta attached.
  The review point sits with the person who holds the card: no subscription is
  cancelled, paused or started by the app. The agent produces the plan; a human
  clicks cancel on the provider's own site and marks it done. Redirect happens in the
  same loop, by correcting a service's sharing flag or pinning a subscription the
  agent wanted to drop.

- **Success criteria:** All eight members have entered their subscriptions within two
  weeks of launch and refresh them at least once a quarter. The first tessellation
  surfaces at least three duplicate subscriptions the family did not know about.
  Combined monthly spend falls 25% within one billing quarter and stays there. At
  least two rotation handoffs complete across household lines without anyone losing
  access to a show mid-season. Zero credentials stored, checked by inspecting the
  schema.

## Prototype

No product code exists yet. The repo holds the README, the writing standard in
`CLAUDE.md` and the two subagents that generate this file and `LAUNCH.md`. There is
nothing to run.

The stack is decided even though it is unwritten: one responsive Next.js and
TypeScript app, installable as a PWA, on Postgres with Supabase for auth and
database, Google sign-in only. The README still calls the stack undecided and lists
household structure as an open question. Both are now settled - multiple households,
shared visibility, no RLS - and the README is stale.

## Customer-facing artifact

The launch PR/FAQ for the family, written for the person who has to enter their
subscriptions before any of this pays off: [LAUNCH.md](LAUNCH.md).

## Notes

I assumed the family will do honest data entry once and lazily thereafter, so the
inventory has to earn its keep on the first screen or the data goes stale and the
product dies. That pushed availability data behind cost optimization: the first build
needs no external API and can ship on hand-entered rows.

The riskiest assumption is that sequencing is behaviourally acceptable. Cancelling
and resubscribing four times a year is more friction than paying $16 a month to not
think about it, and the app has to make the handoff nearly free or the family will
route around it. If two rotations fail, the thesis is wrong and this becomes a
spend-visibility tool rather than an optimizer.

With more time I would settle the availability source by pulling a hundred titles the
family actually watched and measuring TMDB's coverage against them, rather than
choosing on price. I would also model annual-versus-monthly explicitly, since an
annual plan is a bet against ever rotating that service and the app should price that
tradeoff rather than hide it.
