# stream-master

A tool to help my extended family manage our streaming subscriptions: spend less,
know what we're paying for, and figure out the cheapest way to watch the things we
actually want to watch.

## Goals

1. **Subscription inventory** - one shared picture of every streaming service the
   family pays for: cost, billing cycle, renewal date, which household pays, who
   uses it.
2. **Cost optimization** - surface waste. Services nobody watched last month,
   duplicate coverage, annual-vs-monthly savings, plans that could be shared or
   downgraded.
3. **"Where can I watch X?"** - given a show or film, say which services carry it
   and what the cheapest path to watching it is, including rotating between
   services month to month rather than holding all of them year round.
4. **Account management** - keep track of profiles, screen limits, and who holds
   the login for what, without stashing plaintext credentials.

## Status

Early. Nothing is built yet. Tech stack is deliberately undecided until the data
model and the "where can I watch X" data source are settled, since those choices
constrain everything else.

## Open questions

- Availability data source: JustWatch, TMDB watch providers, Watchmode, or manual
  entry. This drives cost, licensing, and how fresh the answers can be.
- Deployment shape: single self-hosted app for the family, a static local tool, or
  a hosted multi-user service.
- How much household structure to model. One family, or several households that
  share some subscriptions and split costs.
