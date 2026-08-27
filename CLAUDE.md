# stream-master

A tool to help an extended family manage streaming subscriptions: track spend, cut
waste and find the cheapest path to watching what they want.

Live at `stream-master.jesse-day.com`, behind one shared family password. Four
households share it. Jesse's mother is a user, which is the bar the interface answers
to.

## What it does, and nothing more

Three things. Anything that does not serve one of them is out of scope until it is
argued for:

1. Show every subscription the family currently pays for.
2. Turn one off, or back on, with a button press.
3. Answer whether a show is already covered, and if not, the cheapest way in.

The four-page prototype that explained a thesis is gone. Read `git log` for it.

## The honesty rules

These are the product. Breaking one is a defect even when the code works.

- **The app records intent. Claude Cowork executes it.** No provider exposes
  subscription management to third parties. Nothing reads as stopped until Cowork
  returns confirmation text it actually read on the page. Never claim a saving the
  family did not get.
- **Unknown is a value, never a null to paper over.** An empty or 404 provider
  response means nobody knows, not that nobody carries it. The two lead to opposite
  decisions and the screen keeps them apart.
- **Absence of a pause flow means no button.** A service with no `PauseTerms` says so
  rather than offering a control the app cannot stand behind.
- **Series-level availability carries the season caveat.** TMDB reports a union across
  seasons: it says Netflix carries NCIS, and Netflix holds 2 of 23. Roughly one series
  in five splits mid-run. Every television answer says so until Stage 3 lands.
- **Demo data must never reach the pause queue.** The households are invented but the
  services are real, and a fixture must not send an agent at a live account.
- **The private file is loud or it is nothing.** No `data/family.json` gives demo
  data. A file that checks out gives private data. A file that is present and wrong
  throws and never degrades to demo, because a reader who cannot tell the two apart
  will eventually publish the wrong one.

## Writing standard

Every written artifact in this repo follows these rules. They apply to the PRD,
release notes, commit messages, docs and any customer-facing text.

Mechanics:
- Action sentences. Active voice. Cut passive constructions.
- Brevity. Length is not evidence of thought.
- Real vocabulary, university-level audience. Do not simplify the diction.
- No Oxford comma. Write "A, B and C".
- Plain dash, never an emdash.
- Keep implementation depth out of written artifacts. Those conversations happen live.

FATS, the rubric. Audit every artifact against all four before presenting it:
- **Focus** - one governing question. Paragraphs that do not serve it get cut.
- **Authority** - command of specifics earns belief. Concrete numbers, named
  tradeoffs, no hedging.
- **Tension** - the piece has stakes. It names the opposing pull and resolves it,
  rather than asserting what nobody would contest.
- **Substance** - the reader carries something away. A gripping piece that leaves no
  impression fails here. Authority is how you earn belief. Substance is whether
  anything was worth believing.

Two documents are exempt from the implementation-depth rule by function, and say so
in their own text: `docs/tmdb-integration.md` and `docs/pause-automation.md`. An
implementation plan that omits implementation is worthless. The mechanics still apply.

## The stack

Next.js 15 App Router, React 19, TypeScript. Postgres via Supabase, provisioned
through the Vercel Marketplace. Deployed on Vercel, Hobby tier, which is
non-commercial only - as is TMDB's free tier. Both boundaries move together if this
ever charges money.

`lib/store/` is the seam. Postgres when a connection is configured, the JSON file
otherwise. `lib/catalog.ts` is the door and knows about neither. The Postgres store
validates its own rows through the same checker as the file rather than trusting its
selects.

**No row-level security, deliberately.** Shared visibility across the family is the
feature and the password gate is the access control. That posture holds only because
`anon` and `authenticated` have no grants at all - Supabase grants them by default,
so any new table in `public` must revoke them explicitly. Silence is a grant. See
`supabase/README.md`.

## Operating it

Read `.claude/skills/stream-master-ops/SKILL.md` before deploying, touching
migrations, running a script or debugging a 503. It carries the footguns that have
already cost time - the `.env.local` escaping trap, the absent migrations ledger, the
middleware runtime that compiles to nothing, and what the Vercel CLI ignores.

## How work lands

**Every change goes through a worktree and a pull request.** No direct commits to
`main`, and no long-lived shared branch accumulating a session's worth of work.

- Branch per unit of work, in its own git worktree, so parallel agents cannot collide
  in one tree and a half-finished change never blocks another.
- Commit inside the worktree. Push the branch.
- Open a PR and merge from there. Vercel builds a preview for every branch, so the PR
  carries a URL somebody can actually open before it reaches four households.
- A subagent leaves its worktree dirty and reports. Jesse decides what commits.

The rule exists because `main` deploys to production. A branch that skips the PR skips
the preview, and the first time anyone sees the change is when the family does.

## Generated artifacts

Two files regenerate from the state of the repo. Both hold finished-quality prose,
not scaffolds, and `/prd` refreshes both at once.

- `SUBMISSION.md` - the internal one-page PRD, owned by the `prd-writer` subagent.
  Five fixed fields. Do not add fields and do not let it run past one page.
- `LAUNCH.md` - the customer-facing PR/FAQ, owned by the `launch-writer` subagent.
  Two or three sentences on the launch, then three to five FAQ entries. Half a page.

Each subagent owns its own file. Neither writes the other's.

`/prd` closes by running `npm run prd:snapshot`, which commits the four artifacts to
the `prd-history` branch. Each cycle overwrites the working copies wholesale, so that
branch is the only record of what a previous draft said. It never touches HEAD or the
working tree. Read it with `git log --oneline prd-history` and
`git diff prd-history~1 prd-history`.

`/prd-back-check` runs the opposite direction: it takes the documents as written,
Jesse's hand edits included, and audits every falsifiable claim against the code. It
reports and never edits, because a divergence can be fixed on either side and that
choice is Jesse's.

Both also ship a browsable copy, `SUBMISSION.html` and `LAUNCH.html`, for dragging
into a browser. `npm run docs` renders them from the Markdown via
`scripts/render-html.mjs`, and `/prd` runs it. The Markdown is the source of truth,
so the HTML never gets edited by hand. Change the renderer, not its output.

## Never commit

`data/` is gitignored and holds real household spend. `.env*` holds the password
digest and connection strings. Check before any commit that adds files.

The Vercel CLI does **not** read `.gitignore`. `.vercelignore` is what keeps
`data/family.json` off a deploy, and it must stay correct.
