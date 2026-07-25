---
description: Regenerate the PRD in SUBMISSION.md and the PR/FAQ in LAUNCH.md from the current state of the repo
allowed-tools: Agent
---

Launch two subagents in parallel, in a single message:

- `prd-writer`, which rewrites `SUBMISSION.md`, the internal one-page PRD.
- `launch-writer`, which rewrites `LAUNCH.md`, the customer-facing PR/FAQ.

Run both synchronously so their summaries land in this conversation rather than
arriving later. Relay both verbatim: what changed, which judgment calls each made
and which claim or field it considers weakest.

Do not edit either file yourself, and do not commit the result.
