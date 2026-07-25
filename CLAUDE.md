# stream-master

A tool to help an extended family manage streaming subscriptions: track spend, cut
waste and find the cheapest path to watching what they want.

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

## The PRD

`SUBMISSION.md` holds a one-page PRD with five fixed fields. The `prd-writer`
subagent regenerates it from the current state of the repo. Treat it as
finished-quality prose, not a scaffold.

Do not add fields, and do not let it grow past one page.
