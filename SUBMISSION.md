# Submission

## The problem I chose

Eight adults in my extended family, spread across four households, pay for streaming
separately and cannot see what the others carry. Four households pay for Netflix.
Three pay for Max. Somebody holds Paramount+ for eleven months past the season that
justified it. Nobody is careless - the information does not exist anywhere.

The obvious fix, one shared login, is dead. Netflix, Disney+ and the rest enforce
household boundaries by IP and device, so a product built on password sharing breaks
within a month and takes the family's trust with it. stream-master bets on the play
that still works: **sequencing**. Services are month-to-month rentals. If the family
knows what it wants to watch and when, each service gets held only in the months that
earn it. On the demo dataset that turns $2,003 a year into $270.

## One-page PRD

- **Problem / who it's for:** Eight technically comfortable adults in one extended
  family across four households. They hold overlapping subscriptions, cannot see each
  other's spend and cannot legally share logins. They need the combined picture and a
  schedule before anyone cancels anything.

- **What it does (and explicitly what's out of scope):** Three screens. The landscape
  shows every subscription with price, payer, renewal date and the sharing the
  provider actually permits, and flags the services paid for twice. The shared
  watchlist ranks titles by how many family members want them and prices the cheapest
  way in, including rent and buy. The plan turns the watchlist into a twelve-month
  calendar naming which household carries which service in which month. Out of scope
  by decision: no credential storage and no agentic cancellation, ever - the app
  proposes and a human executes on the provider's own site; no row-level security,
  because eight close relatives seeing who pays for what is the feature; no payment
  splitting or settlement; no viewing-history ingestion; no scale design past a few
  dozen users. The family's own numbers stay out of the repository too. They live in
  an ignored `data/family.json`, and a malformed one throws rather than falling back
  to demo figures, because a reader who cannot tell the two datasets apart will
  eventually publish the wrong one.

- **How it couples to the demand plan:** It is the whole engine. Every title carries
  the month the family intends to watch it, and the plan places services only against
  those months. A service nobody named gets listed as unjustified - on the demo data
  that is Netflix at $648 a year, plus Hulu, Prime Video and Paramount+. The coupling
  is strict enough to refuse what it cannot verify: The Brutalist has no confirmed
  availability, so it lands in the unplaced list rather than being guessed into a
  month.

- **How a human and the agent co-work:** A family member delegates by adding titles
  they want and the month they want them. The agent returns the calendar with the
  dollar delta, the season-level warnings and the titles it could not place. The
  review point sits with whoever holds the card: the app never cancels, pauses or
  starts a subscription. A human executes on the provider's site and marks it done.
  Redirect happens by pinning a subscription, correcting a sharing flag or moving a
  title's planned month.

- **Success criteria:** All eight members enter their subscriptions within two weeks
  and refresh quarterly. The first landscape on the real family file names at least
  two duplicated services and $50 a month of redundant spend nobody had counted - the
  demo file yields exactly two, Netflix and Max, at $88 redundant. Combined monthly
  spend falls 25% within one billing quarter and stays there; the demo claims 87%, so
  25% is the floor that keeps the thesis alive. At least two cross-household handoffs
  complete without anyone losing a show mid-season. Zero titles scheduled onto a
  service that does not carry every season, checked against the partial-placement list
  on every plan render.

## Prototype

A Next.js and TypeScript app running against a local dataset, with 58 tests covering
the domain rules, the catalog loader and the TMDB client.

```
npm install
npm run dev     # http://localhost:3200
npm test
```

Three routes: `/` landscape, `/watchlist` and `/plan`. Every page carries a badge
naming which dataset is on screen. Without a private file the app runs the committed
demo data, and swapping either one for Postgres means changing `loadCatalog` and
nothing else. Availability sits behind a vendor-neutral seam with a fixture provider
today. A complete TMDB client ships with retry, typed errors and season-level provider
calls, and nothing calls it yet - the adapter joining it to the seam is the next piece
of work and the only thing between the plan and real data.

The hardest decision in the build is that unknown never means unavailable. A source
that fails, times out or has no record produces unknown, which the plan refuses to
schedule rather than quietly dropping.

The README still ranks one-press pause and the idle-service alarm P0. Neither exists.
What shipped is the rotation engine the README ranks P1, because sequencing is the
claim worth testing first and pause mapping is hand work that proves nothing. Trust
the code for the current priority order.

## Customer-facing artifact

The launch PR/FAQ, written for the relative who has to enter their subscriptions
before any of this pays off: [LAUNCH.md](LAUNCH.md).

## Notes

The riskiest assumption is behavioural, not technical. Rotating four times a year is
more friction than paying $17 a month to not think about it, and the demo's 87% saving
assumes the family cancels on cue. If two handoffs fail, this is a spend-visibility
tool and the plan screen is decoration.

The second risk is data. TMDB's series-level watch-provider response is a union across
seasons, so a show listed on one service may carry only half of it there. The domain
handles that split already - it prefers a complete carrier over a cheaper partial one
and names the stranding when every option runs short. Nobody has measured how often
TMDB's seasons disagree with its own series answer. That spike, specified in
`docs/tmdb-integration.md`, gates whether TMDB can be the sole source, and with more
time I would run it before writing another line of product code.
