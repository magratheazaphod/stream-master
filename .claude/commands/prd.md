---
description: Regenerate the one-page PRD in SUBMISSION.md from the current state of the repo
allowed-tools: Agent
---

Launch the `prd-writer` subagent to regenerate `SUBMISSION.md`.

Run it synchronously so its summary lands in this conversation rather than arriving
later. Relay the summary verbatim: what changed, which judgment calls it made and
which field it considers weakest.

Do not edit `SUBMISSION.md` yourself, and do not commit the result.
