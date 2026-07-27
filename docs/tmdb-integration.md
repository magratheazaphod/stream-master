# TMDB integration - implementation handoff

Availability data is the feature that turns a wish list into a rotation schedule. This
document specifies how stream-master gets it from TMDB, staged so each piece hands off
to a subagent cleanly.

Scope note: the repo writing standard bars implementation depth from written artifacts.
That rule governs `SUBMISSION.md` and `LAUNCH.md`, the artifacts a reader outside the
build consumes. This document is the exception by function - an implementation plan
that omits implementation is worthless. The mechanics still apply: active voice,
brevity, plain dashes, no Oxford comma.

## The governing constraint

TMDB's series-level watch providers response is a **union across all seasons**. A show
returning "Netflix" may carry seasons 1-3 there and 4-6 elsewhere. stream-master sells
sequencing - "hold Apple TV+ through the season finale" - so a union that hides a
mid-series provider split produces a rotation plan that strands somebody mid-season.
That is the first handoff failing, which is the exact failure the PRD names as fatal to
the thesis.

Season resolution is therefore required for TV, not a stretch goal. Every stage below
exists to serve that.

Stage 0 has since run and confirmed this empirically. See `tmdb-coverage.md`: roughly
one series in five carries a real mid-series split, and NCIS reports Netflix at the
series level while Netflix holds two of its twenty-three seasons.

## Standing rule - do not abuse the TMDB endpoint

This binds every stage. TMDB disabled its published rate limit in December 2019 and now
states only that limits sit "somewhere in the 40 requests per second range", asking
callers to be respectful and to honour a 429. No hard ceiling means restraint is a
design requirement, not a courtesy. The service is free and non-commercial, and access
gets revoked for abuse.

- **Cache aggressively.** The API terms permit retaining data for up to six months.
  Availability moves monthly at most. Prefer slightly stale data over a fresh request,
  always.
- **Sample seasons, do not enumerate them.** First, middle and last catches a split in
  3 requests where a 22-season show costs 22. Enumerate fully only when the sample
  disagrees.
- **Fetch only titles on a demand list.** Never walk the catalogue.
- **Never bulk-scrape**, and never fan out across every season of every title. The
  Stage 0 spike spent 471 requests on 36 shows. That was a one-off measurement and it
  is not a template for anything that runs on a schedule.
- **Honour 429 with backoff.** Treat one as a signal to slow down permanently, not to
  retry harder.

## Stage map

| # | Stage | Model | Effort | Depends on |
|---|---|---|---|---|
| 0 | Coverage spike | Opus | high | done - see `tmdb-coverage.md` |
| 1 | Schema and migrations | Opus | high | 0 |
| 2 | TMDB HTTP client | Sonnet | medium | 1 |
| 3 | Provider interface and TMDB adapter | Opus | high | 2 |
| 4 | Refresh job | Sonnet | medium | 3 |
| 5 | Query layer | Sonnet | medium | 3 |
| 6 | Attribution compliance | Sonnet | low | 5 |
| 7 | Test suite and fixtures | Sonnet | medium | 3 |
| 8 | Adversarial review | Opus | xhigh | all |

Stages 4, 5 and 7 run in parallel once 3 lands. Stage 6 needs a render surface from 5.

Model and effort here are floors, not ceilings. Escalate if a stage fights back. Never
drop a stage rated Opus to a smaller model to save time - stages 0, 1, 3 and 8 carry
decisions that are expensive to reverse.

---

## Stage 0 - Coverage spike

**Model: Opus. Effort: high.** Judgment-heavy measurement whose result gates whether
the rest of the plan is even correct. Do not delegate this to a cheaper model.

A throwaway script, not product code. Put it in the scratchpad and delete it after.

Assemble a hundred titles the family actually watched over the past two years. Ask the
four households for real lists rather than inventing a corpus - a synthetic list of
prestige TV will overstate TMDB's coverage badly. For each title, measure:

1. Does TMDB resolve the title at all, and how ambiguous is the search hit.
2. Does the series-level endpoint return a US flatrate provider.
3. Does every season endpoint return one.
4. **How often does the season union disagree with the series-level union.** This is
   the number the whole plan turns on.
5. How often TMDB's season count diverges from what the platform advertises. TMDB
   numbers seasons in production order, JustWatch in the platform's streaming order.
   Futurama on Disney+ is the canonical break.

**Exit criteria.** Write the findings to `docs/tmdb-coverage.md` with the five rates
above as raw counts, not percentages of a fuzzy denominator. State a go or no-go on
TMDB as sole source. If season coverage lands under roughly 80%, stop and escalate to
Jesse before Stage 1 - the fallback to evaluate is the Streaming Availability API from
movieofthenight, which exposes season and episode data on a free tier of 100 requests
a day. Watchmode is not the fallback. Its episode-level links sit behind $349 a month
and its free tier grants no granularity TMDB withholds.

---

## Stage 1 - Schema and migrations

**Model: Opus. Effort: high.** Schema constrains every stage after it and migrating a
live Postgres later costs more than getting it right now.

Postgres via Supabase, per the settled stack. No row-level security - shared visibility
across the family is the feature.

Five tables:

- `providers` - TMDB provider id, name, logo path, display priority. Seed from
  `/watch/providers/tv` and `/watch/providers/movie`.
- `titles` - TMDB id, media type, name, release year. TMDB id plus media type is the
  natural key. Do not invent a surrogate id that shadows it.
- `title_seasons` - title, season number, TMDB season id, episode count, air date.
- `availability` - title, **nullable** season number, provider, country, offer type,
  `observed_at`. Null season means the row came from the series-level union. Offer type
  is an enum over TMDB's vocabulary: `flatrate`, `free`, `ads`, `rent`, `buy`. Carry
  rent and buy from day one even though the first planner ignores them - annual-versus-
  monthly reasoning needs them and backfilling history is impossible.
- `availability_fetch` - the audit table, one row per request: what was asked, the HTTP
  status and a result enum of `OK`, `EMPTY`, `NOT_FOUND` or `ERROR`.

That last table is load-bearing, not bookkeeping. It is what lets the product
distinguish **unknown** from **unavailable**, and Stage 3 depends on the distinction.

Country is a column from the start. The family is US-only today and the app should
still never bake `US` into a primary key.

**Exit criteria.** Migrations apply and roll back cleanly against a local Supabase.
Seed script populates `providers`. No product code reads these tables yet.

---

## Stage 2 - TMDB HTTP client

**Model: Sonnet. Effort: medium.** Well-specified mechanical work with a known shape.

A typed client, nothing above transport. No business logic and no database access.

Non-negotiable details, each of which burns a day if missed:

- **Auth is the v4 read access token in an `Authorization: Bearer` header.** The
  watch-provider endpoints do not work with the older `api_key` query parameter. This
  is the single most common failure reported against these endpoints.
- **Do not fetch providers via `append_to_response`.** For TV it returns data that
  disagrees with the dedicated endpoint. Always call the provider endpoints directly.
- Rate limiting: TMDB no longer publishes a hard cap. Ship a configurable token bucket
  defaulting to something conservative like 20 requests a second, and do not tune it up
  without evidence. Family-scale volume never approaches any plausible limit.
- Retry with exponential backoff on 429 and 5xx. Never retry a 404 - for provider
  endpoints a 404 is a real answer that Stage 3 needs to see.
- Surface 404 to the caller as a typed result, not an exception.

Endpoints in scope: `/search/tv`, `/search/movie`, `/tv/{id}`, `/movie/{id}`,
`/tv/{id}/watch/providers`, `/tv/{id}/season/{n}/watch/providers`,
`/movie/{id}/watch/providers`, `/watch/providers/{tv,movie}`.

**Exit criteria.** Every endpoint typed and unit-tested against recorded fixtures. Zero
live network calls in the test suite.

---

## Stage 3 - Provider interface and TMDB adapter

**Model: Opus. Effort: high.** The semantics live here. Everything downstream inherits
whatever this stage decides about correctness.

Define `AvailabilityProvider` as the seam that keeps the vendor swappable, then write
exactly one implementation against TMDB. The interface must not leak TMDB vocabulary -
if a future adapter for movieofthenight cannot satisfy it without contortion, the
abstraction is wrong.

Four rules the adapter enforces:

1. **Fetch series-level first, then fan out to seasons.** Only fan out for titles on
   somebody's demand list. Fanning out across the whole catalogue wastes quota for no
   product benefit.
2. **Store the series union and the per-season rows separately.** Never collapse one
   into the other.
3. **Flag disagreement between them as a first-class signal.** A show whose series
   union names a provider that no season names is either a data error or a partial
   catalogue, and the rotation planner must see the difference. This also catches
   production-order versus streaming-order drift for free.
4. **Empty or 404 means unknown, never unavailable.** Persist the distinction through
   to the query layer. A rotation plan built on a confidently wrong "not available"
   costs the family more trust than one that admits a gap.

**Exit criteria.** Adapter writes normalized rows and fetch-audit rows for a fixture
set covering a clean show, a show split across providers mid-series, a show with a
season-numbering divergence and a title TMDB cannot resolve.

---

## Stage 4 - Refresh job

**Model: Sonnet. Effort: medium.** Orchestration over an interface Stage 3 already
settled.

A job refreshing only titles on a demand list, never the catalogue.

Weekly, not nightly. Availability moves monthly at most and the standing rule above
prefers stale data over traffic. Under season sampling a 40-title family list costs
roughly 120 requests a week.

- Stale-first ordering by `observed_at`, so an interrupted run makes progress.
- Idempotent. Two runs in a day produce one logical result.
- Structured run summary: titles attempted, rows changed, unknowns, errors.
- **Never delete availability rows.** Append with a new `observed_at`. Availability
  history is what will eventually let the planner reason about how fast a catalogue
  churns.

**Exit criteria.** Job runs end to end against a seeded database. Killing it mid-run
and restarting loses nothing and duplicates nothing.

---

## Stage 5 - Query layer

**Model: Sonnet. Effort: medium.** Reads over a settled schema.

The read API the rotation planner will consume. Three questions to answer:

- Which providers carry this title, and at which seasons.
- Which titles on the demand list does this set of subscriptions already cover.
- Which titles does nothing in the family's current inventory cover.

Every response carries confidence: confirmed, stale past a threshold, or unknown.
Unknown is a value the caller must handle, not a null to paper over.

**Exit criteria.** Typed query functions with tests over a seeded fixture database.

---

## Stage 6 - Attribution compliance

**Model: Sonnet. Effort: low.** Simple, mandatory and quick.

TMDB's terms require attributing TMDB as the source. The watch-provider data
additionally requires attributing **JustWatch**, with a reference or logo on each media
item that displays provider data. Non-compliance gets API access revoked, so this is
not a polish task to defer.

Render both attributions wherever availability appears. Add a short licensing note to
the README recording that TMDB's free tier covers non-commercial use only, that
commercial use needs a written agreement with TMDB, and that JustWatch's own API
forbids commercial use outright. stream-master is a family tool, so the free tier fits
today. Write the constraint down now while it costs nothing.

**Exit criteria.** Attribution renders on every availability surface. README carries
the licensing note.

---

## Stage 7 - Test suite and fixtures

**Model: Sonnet. Effort: medium.** Runs parallel to 4 and 5.

Record real TMDB responses once, commit them as fixtures and never call the live API
from tests. The fixture set must cover the four Stage 3 cases plus a rate-limited 429
and a malformed payload.

**Exit criteria.** Suite runs offline in under thirty seconds.

---

## Stage 8 - Adversarial review

**Model: Opus. Effort: xhigh.** The last chance to catch a correctness error before the
planner builds on this.

Review against the governing constraint, not against style. The questions that matter:

- Can any path collapse the series union into season data, or the reverse.
- Can unknown ever reach the user rendered as unavailable.
- Does a season-numbering divergence produce a wrong answer or a flagged one.
- Would swapping the TMDB adapter for another vendor touch anything outside Stage 3.

**Exit criteria.** Findings reported with severity. Correctness findings block; style
findings do not.

---

## Handing a stage to a subagent

Each stage is written to be a self-contained brief. Pass the stage section verbatim,
plus this document's governing-constraint section, and set `model` and `effort` from
the stage map. Subagents defined in `.claude/agents/` take `model` in frontmatter, as
`prd-writer` does.

Two standing constraints for every stage:

- Do not commit. Leave the tree dirty for Jesse.
- Do not touch `SUBMISSION.md` or `LAUNCH.md`. The `prd-writer` and `launch-writer`
  subagents own those and will pick this work up on their own cadence.
