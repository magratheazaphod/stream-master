# Pausing - the part that never changes

Read this first, then the per-service playbook. Those files carry **only** what
their provider does differently. Everything below applies to every service in the
queue, including one with no playbook at all.

`docs/pause-automation.md` is the contract between the app and this agent. This
file is how the agent honours it. Where the two disagree, the contract wins and
the divergence goes in the run summary.

## What this run is

The app records a pause. It cannot execute one. No provider exposes subscription
management to third parties, so stopping the billing means driving a logged-in
browser. That is this task. It never handles a credential, and it decides nothing:
every request it acts on was approved by a person first.

## Pre-flight

A Cowork task still dispatches and still records `lastRunAt` when its granted
folders have gone. Nothing upstream will stop a run against an empty mount. **The
checks below are the only real guard**, so run all of them before opening a tab.

1. **Read `data/pause-queue.json`.** Use the `Read` tool, with the host path
   `/Users/Siwen/projects/stream-master/data/pause-queue.json`. Do not use bash.
   File tools run on the host; the shell runs in the VM and its mount paths are
   different, so `test -f` answers a question nobody asked.
2. **Abort loudly if that Read fails.** A missing or unreadable queue means the
   grant is gone, not that there is no work. Say so as the run summary and stop.
   Never treat it as an empty queue and never reconstruct one from anywhere else.
3. **Abort if it does not parse**, or if `version` is not `1`. A truncated write
   is the app's problem to fix, and half a queue is worse than none.
4. **Read `cowork/pausing.md` and the playbook for every distinct `method` in the
   queue** before the first action. A playbook fetched mid-flow is a playbook
   fetched while a cancellation is half-done.
5. **Run no git command in this repo.** Not `status`, not `add`, not `checkout`.
   Local git needs no network, so every one of them succeeds against Jesse's real
   working tree, and this sandbox cannot remove a lock file it leaves behind. The
   damaging command is the one that works. Name what needs committing in the run
   summary and let a Claude Code session pick it up.

## The approved gate

**Act only on requests where `approved` is exactly `true`.** Not truthy, not
`"true"`, not absent. Anything else is `skipped`, recorded as such, and left
alone.

This gate is load-bearing because execution is unattended and `approvedPermissions`
are sticky across runs. Without it a scheduled run cancels a subscription nobody
chose to cancel, using an approval granted weeks earlier for something else.

Also skip, and record `skipped`, when:

- `action` is neither `pause` nor `resume`.
- `method` is missing, or names a method with no playbook.
- `manageUrl` is absent, or its host is not in the task's `chromeAllowedDomains`.

## Picking the playbook

`method` mirrors `PauseMethod` in `lib/types.ts` and decides the shape of the
flow. `serviceId` decides the file.

| `method` | what the flow is | where it happens |
|---|---|---|
| `native-pause` | billing stops, the account survives | the provider's own account page |
| `cancel-resubscribe` | no pause exists, so stopping means cancelling | the provider's cancel flow |
| `store-managed` | bought through a channel store | the store's subscription page, not the provider's |

`store-managed` is the one that catches people out: the Paramount+ request is
settled on Amazon, and nothing on paramountplus.com can stop that billing. Trust
`method` over the service name.

Playbooks: `netflix-pause.md`, `max-pause.md`, `disneyplus-pause.md`,
`hulu-pause.md`, `appletv-pause.md`, `paramount-pause.md`, `peacock-pause.md`.

**No playbook, no attempt.** Record `skipped` with the reason. Then write the
playbook in your run summary as prose, so the next run has one.

## Rules every playbook inherits

These come from the contract verbatim in substance. A playbook may add to them
and may never soften one.

- **Never enter a password, a card number or any credential.** If a flow asks to
  re-authenticate, the outcome is `blocked` and a human takes over. No exceptions,
  including when the browser offers to fill it for you.
- **Never accept a retention offer.** These flows push a discount, a downgrade or
  a free month in place of stopping. Taking one is a purchase decision the family
  did not authorise. Decline and continue, or report `blocked`.
- **One attempt per request per run.** A flow that fails does not get retried in
  the same run. Retrying a half-finished cancellation is how a household ends up
  with two cancellations, or none.
- **Read the confirmation before claiming success.**
- **Stop the whole run after two consecutive `blocked` or `failed` results.** A
  provider redesign breaks every request the same way, and grinding through the
  queue turns one stale playbook into ten wrong records.

## Evidence

**`done` requires evidence.** The result carries the confirmation text you
actually read off the page - the sentence, not a paraphrase of what the button
said. An agent that clicked and assumed is reporting `failed`.

Concretely, before writing `done`:

1. Read the page after the final click. A fresh read, not the pre-click one.
2. Find the sentence that names the state change, and ideally a date. "Your
   membership ends September 14." "Your subscription is paused until 1 November."
3. Copy that sentence into `evidence`. Put its date into `billingStopsOn` as an
   ISO date, and leave `billingStopsOn` absent when the page names no date rather
   than computing one from the renewal.
4. Screenshot to `cowork/evidence/<requestId>.png` and record the path.

The whole product rests on never telling a family they saved money they did not
save. A `blocked` costs one manual click. A wrong `done` costs the trust that
makes the next recommendation worth reading.

`already` needs evidence too, and it is the same standard: the page said the
subscription was already paused, or already active. An `already` inferred from a
missing button is a `blocked`.

## Writing the results

Write `data/pause-results.json` with the `Write` tool, host path, whole file at
once. Shape per `docs/pause-automation.md`:

```json
{
  "version": 1,
  "writtenAt": "2026-08-26T14:40:00Z",
  "results": [
    {
      "requestId": "req-2026-08-26-netflix-fairhaven",
      "outcome": "done",
      "observedAt": "2026-08-26T14:38:12Z",
      "billingStopsOn": "2026-09-14",
      "evidence": "Confirmation page read: 'Your membership ends September 14'.",
      "screenshot": "cowork/evidence/req-2026-08-26-netflix-fairhaven.png"
    }
  ]
}
```

- **One result per request in the queue.** Every request, including the skipped
  ones. A request with no result is indistinguishable from a request never seen,
  and the next run cannot tell them apart either.
- `outcome` is one of `done`, `already`, `blocked`, `failed`, `skipped`.
- `evidence` on a `blocked` or `failed` says what stopped you, in enough detail
  that a human can finish it by hand: the screen you reached, the button you
  could not find, the prompt you refused to answer.
- **The file is overwritten, not appended.** It reports this run.
- **Write it even when the run stopped early.** A stop-loss abort with no results
  file throws away the two results that explain why it aborted. Write the results
  you have, then stop.

## The run summary

Close with, in this order:

1. Counts by outcome.
2. Every `blocked` and `failed`, named, with what a human must do next.
3. What needs committing, since you ran no git. `data/` is gitignored, so this is
   usually nothing - say so rather than staying silent.
4. Any playbook that fought you, and how. A provider redesign discovered on this
   run and not written down is a redesign rediscovered on the next one.
