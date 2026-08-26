---
description: Audit every claim in SUBMISSION.md and LAUNCH.md against what the repo actually implements
allowed-tools: Read, Grep, Glob, Bash
---

Audit the written artifacts against the code. `/prd` writes the documents from the
repo. This runs the arrow the other way: it takes the documents as given, including
Jesse's hand edits, and asks which of their assertions the repo actually honours.

Read-only. Do not edit `SUBMISSION.md`, `LAUNCH.md`, their HTML renderings or any
source file, and do not run `npm run docs`. If a claim is wrong, the fix is Jesse's
call - either the prose overstates the product or the product owes the prose a
feature, and which one it is matters more than the edit.

## Method

1. Read `SUBMISSION.md` and `LAUNCH.md` in full.
2. Extract every falsifiable assertion. A claim is falsifiable if code could
   contradict it: a capability the product has, a boundary it enforces, a number it
   shows, a thing it refuses to do, a command that runs it. Skip motivation,
   audience description and market reasoning - those are Jesse's to defend, not the
   repo's.
3. Verify each one against the source tree, the tests and `git log`. Prefer the code
   over the README and over comments. A test that asserts the behaviour is the
   strongest evidence available; a function that merely exists is weaker.
4. Run the test suite once (`npm test`) and check the prototype's stated run commands
   still work. A PRD that names a broken command is diverging whatever else it says.

## Verdict per claim

Assign exactly one, and cite `file:line` for anything you assert:

- **Backed** - the code does this. Cite where.
- **Partial** - the code does a weaker version. Name precisely what is missing.
- **Unbacked** - nothing implements it. Distinguish aspiration the reader would
  forgive from a claim the reader would call a lie.
- **Contradicted** - the code does something the document denies, or refuses
  something the document promises. These lead the report.
- **Unverifiable** - no code could settle it. Say why, then move on.

Out-of-scope claims cut both ways. "No credential storage, ever" is Contradicted the
moment a credential field appears in a schema. Check the refusals as hard as the
promises, because those are the claims the reader trusts most.

## Also flag the other direction

The repo can diverge by growing. Name anything the code does that a reader of the
PRD would not expect: a shipped surface no field mentions, a behaviour that widens
the stated scope, a dependency that changes what the product is. Silence in the PRD
about something real is a divergence too.

## Report

Return the findings to the conversation. Write no file.

Lead with a one-line verdict: does the PRD currently describe this repo, or not.
Then the Contradicted and Unbacked claims, quoted verbatim from the document with
the evidence against them and the file:line that settles it. Then Partial. Then the
reverse-direction findings. Fold Backed claims into a single count rather than
listing them.

Close with the one edit that would buy the most accuracy for the least prose, and
say whether it belongs in the document or in the code.

Follow the writing standard in `CLAUDE.md` for the report itself: active voice,
brevity, no hedging. If everything checks out, say so in one line and stop. Do not
pad the report to look thorough.
