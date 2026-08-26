---
description: Regenerate the PRD in SUBMISSION.md and the PR/FAQ in LAUNCH.md from the current state of the repo
allowed-tools: Agent, Bash
---

Launch two subagents in parallel, in a single message:

- `prd-writer`, which rewrites `SUBMISSION.md`, the internal one-page PRD.
- `launch-writer`, which rewrites `LAUNCH.md`, the customer-facing PR/FAQ.

Run both synchronously so their summaries land in this conversation rather than
arriving later. Relay both verbatim: what changed, which judgment calls each made
and which claim or field it considers weakest.

Once both have returned, run `npm run docs`. That renders `SUBMISSION.html` and
`LAUNCH.html` from the two Markdown files, so Jesse can open either draft in a
browser. Each subagent already runs it, so this pass is a backstop: it guarantees
both pages match the final Markdown whatever order the subagents finished in.
Report the two HTML paths alongside the summaries.

Then run `npm run prd:snapshot`. It commits the four artifacts to the `prd-history`
branch, so this cycle's drafts survive the next cycle overwriting them. It touches
neither HEAD nor the working tree, and it commits nothing but those four files. It
prints `no change` and exits when the documents did not move. Report the short SHA.

Do not edit any of the four files yourself, and do not commit anything to `main`.
