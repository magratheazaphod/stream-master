# TMDB coverage spike - findings

Stage 0 of `tmdb-integration.md`. The question: does TMDB's season-level watch-provider
data hold up well enough to plan a rotation on, or does stream-master need a paid
source.

**Verdict: GO.** TMDB survives as sole availability source. Season coverage is 98.6%
and the season endpoint is materially better than the series-level union it replaces.

## Method

471 responses against the live API, US region, cached to disk and analysed offline. 36
series drawn from a corpus weighted toward the shows most likely to break: long-runners
with many seasons and catalogue shows that have changed homes. `The Simpsons` at 37
seasons, `Law & Order: SVU` at 27, `NCIS` at 23.

For each series: the detail endpoint for the season list, the series-level provider
union, then every season individually. Season 0 (specials) excluded throughout.

### What this measurement does not cover

Three gaps, stated plainly because they bound the verdict.

- **Not the family's real watch list.** The corpus is US network and cable heavy. The
  family skews British, kids and K-drama, and Jesse skews toward sport. Sport is the
  known blind spot - a World Cup or a Formula 1 season is a live rights deal, often
  regional and often not a catalogue title at all. TMDB will not model it and the
  rotation planner should not pretend otherwise.
- **Films were not measured.** The run died before reaching them. Films have no season
  problem, so the risk is low, but the number is absent rather than good.
- **US only.** One of the four households is in London. Availability genuinely differs
  and the fetch never asked.

## Findings

### Season data is present and reliable

| Measure | Count |
|---|---|
| Seasons probed | 363 |
| Returned US data | 358 (98.6%) |
| Returned 200 with no US entry | 5 |
| Returned 404 | 0 |
| Series with no season resolving at all | 0 |
| Series with at least one US flatrate provider | 36 of 36 |

Zero 404s across 363 season requests. The season endpoint is not the fragile,
half-populated thing the forum chatter suggests.

### The union hides mid-series splits, and that is the whole finding

45 provider-season splits across the 36 series - a provider carrying some seasons of a
show but not all. Excluding live-TV bundles like YouTube TV and fuboTV, which are not
subscription streaming in any sense the planner cares about, **22 real splits remain,
affecting 8 of 36 series**.

The series-level union reports every one of these as plain availability:

| Show | Provider | Seasons carried |
|---|---|---|
| NCIS | Netflix | 18-19 of 23 |
| Brooklyn Nine-Nine | Netflix | 5-8 of 8 |
| Criminal Minds | Prime Video | 1-5 of 19 |
| Criminal Minds | Hulu | 1-15 of 19 |
| Doctor Who | Prime Video | 1 of 13 |
| CSI | Hulu | 2-7 of 15 |
| Law & Order: SVU | Hulu | 1-26 of 27 |

NCIS is the case that indicts the union outright. The series-level response says
Netflix. Netflix has two of twenty-three seasons. A planner reading the union tells a
household to hold Netflix for NCIS and strands them on season one - the exact
first-handoff failure the PRD names as fatal to the sequencing thesis.

Roughly one series in five carries a real mid-series split. That is not an edge case.

### Series-only disagreement: zero

No provider appeared in a series union while appearing in no season. The union is a
faithful roll-up, never inventing a provider. Its failure is silent imprecision about
extent, not fabrication. Good news for the adapter: the disagreement it must handle is
`partial`, and `series-only` can be treated as an anomaly worth logging rather than an
expected state.

### Season-count divergence is real but small

Six of 36 series report more seasons in TMDB's detail endpoint than return provider
data. South Park is the worst at 29 versus 8. Most are off by one - Severance 3 versus
2, Ted Lasso 4 versus 3 - an unaired or just-announced season with no provider yet.
That is correct behaviour, not drift.

South Park is the genuine production-order versus streaming-order break the plan
predicted. It needs the unknown path, not a guess.

## What Stage 3 must handle

1. **Never plan from the series union alone.** It is a discovery aid. Every rotation
   decision reads season rows.
2. **Model partial coverage as a first-class result.** Not a flag on an otherwise
   normal answer. The planner must be able to say "Netflix covers seasons 18-19"
   and refuse to promise the rest.
3. **Classify providers.** Live-TV bundles were half the raw splits. Carrying them into
   the planner doubles the noise for households that own no such bundle. TMDB's
   provider directory is the input to this classification.
4. **Collapse provider variants.** `Netflix` and `Netflix Standard with Ads`, `Paramount
   Plus Essential` and `Paramount Plus Premium` and three Paramount+ channel resellers
   are one subscription decision each, not six. Unmerged, CSI alone contributes six
   splits describing one fact.
5. **Treat a 200 with no US entry as unknown.** Five of 363. Rare enough to be cheap,
   real enough to matter.

## Request budget

The spike burned 471 requests to measure 36 shows. Production must not work that way.

TMDB disabled its published limit in December 2019 and now states only that limits sit
"somewhere in the 40 requests per second range", asking callers to be respectful and to
honour a 429. There is no hard ceiling to hide behind, which makes restraint a design
requirement rather than a courtesy.

The API terms permit caching for **up to six months**. Availability moves on a monthly
cadence at most, so a weekly refresh is already far fresher than the product needs.
Slightly stale beats hammering the endpoint.

Three rules for the refresh job:

- **Sample seasons, do not enumerate them.** First, middle and last catches a
  mid-series split in 3 requests where Grey's Anatomy costs 22. Enumerate fully only
  when the sample disagrees, which is the signal that a split exists.
- **Only titles on a demand list.** Never the catalogue.
- **Refresh weekly, not nightly**, and only where `observed_at` is stale.

Under those rules a plausible family list of 40 titles costs roughly 120 requests a
week. The full-enumeration approach would cost thousands.
