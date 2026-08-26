# Pause automation - the Cowork contract

The app can record a pause. It cannot execute one. No streaming provider exposes
subscription management to third parties, so the only way to actually stop billing
from software is to drive a logged-in browser. Claude Cowork does that, against the
Chrome session Jesse is already signed into, and it never handles a credential.

This document is the seam between the two. Read it before touching either side.

Scope note: the repo writing standard bars implementation depth from written
artifacts. That rule governs `SUBMISSION.md` and `LAUNCH.md`. This document is an
implementation contract and the exception is deliberate, as it is for
`tmdb-integration.md`. The mechanics still apply.

## The governing constraint

**Cowork cannot reach a host port.** Its shell runs in a VM, so `localhost:3200`
does not exist from where the agent sits. There is no API call between the app and
the agent, no webhook and no handshake. Designing one wastes a day and cannot work.

The integration is **files in a shared, granted folder**. The app writes a queue,
Cowork reads it, acts, and writes results back. The app ingests the results on its
next read. Both sides treat the other as an inbox, never as a service.

## The second constraint, once the app is hosted

The app deploys to Vercel so four households can reach it. That breaks the
assumption above, because **a Vercel function cannot write to Jesse's Mac** and
Cowork cannot read a serverless filesystem. The two halves no longer share a disk.

Neither half moves. Cowork must stay on the Mac, because the whole mechanism is
Jesse's signed-in Chrome session, and no server has one. The app must stay hosted,
because the point is that his mother opens a URL without asking anyone. So a third
piece appears between them:

```
Vercel app  ->  Postgres  <->  a sync job on the Mac  <->  data/*.json  <->  Cowork
```

- The hosted app writes a pause request to Postgres. It never touches a file.
- A **sync job on the Mac** pulls approved requests into `data/pause-queue.json`,
  and pushes `data/pause-results.json` back up. It runs on the Mac because that is
  the only machine that can see both the database and the queue file.
- Cowork's contract does not change at all. It still reads one file and writes
  another, and it neither knows nor cares that a database exists.

That last point is the design holding together. The file contract below stays
exactly as it is, and the sync job absorbs the whole difference. If a change to
this document ever makes Cowork aware of Postgres, the seam has been put in the
wrong place.

**The Mac becomes a required participant.** A pause requested while the Mac is
asleep waits, and the UI must say so rather than implying an agent is standing by.
`requested` and `in flight` are different states and the family can tell them apart.

### The sync job, as built

`npm run pause:sync`, in `scripts/pause-sync.mts`. A script and not a route: a route
would need the Mac reachable from the internet, which is the arrangement this design
exists to avoid. It runs two directions each time, pull before push, so a run that
dies between them has handed work out rather than lost an answer.

- **Pull.** Approved requests with no `handed_off_at` go into `data/pause-queue.json`,
  and only then is the stamp written. Stamping first and failing to write would leave
  a request marked as handed off to a file that does not carry it, and nothing would
  pick it up again.
- **Push.** The whole of `data/pause-results.json` goes up on every run. Cowork
  appends to that file and never trims it, so the repeat is expected and a unique
  index on the request, the outcome and the observed instant makes it a no-op. A
  result naming a request the database has never seen is dropped rather than
  invented.

`handed_off_at` is what the screen reads. Null is `Requested, not picked up`. A
timestamp is `With the agent`. The column never reaches the queue file - adding a
field to the contract would make Cowork aware of a machine it has no business
knowing about, which is the failure this whole arrangement is shaped to avoid.

Nothing schedules the job yet. Until something does, somebody runs it by hand, and a
pause sits in Postgres until they do.

Two corollaries that follow directly:

- **Cowork runs no git commands in this repo.** Local git needs no network, so
  `checkout`, `add` and `commit` all succeed against Jesse's real working tree,
  and the sandbox cannot remove a lock file it leaves behind. The damaging command
  is the one that works. Cowork writes files and names what needs committing in
  its run summary. A later Claude Code session picks it up from `git status`.
- **Cowork's file tools run on the host, its shell runs in the VM.** A path that is
  correct in `Read` is wrong in `bash`. Write every pre-flight check as a `Read`.

## What gets granted

The Cowork task gets `/Users/Siwen/projects/stream-master/data/` and
`/Users/Siwen/projects/stream-master/cowork/`. Not the repo root - the agent has no
business in `app/` or `lib/`, and a narrow grant is the cheapest guard there is.

Playbooks live in `cowork/`, in the repo, **not** in `~/.claude/skills/`. That
directory is on Cowork's protected list and is unreachable from a Cowork session by
design. A playbook the agent cannot read is not a playbook.

Per-task Chrome domains are allowlisted to exactly the services in the queue.

## The two files

Both live in `data/`, which is gitignored. They hold real household state.

### `data/pause-queue.json` - the app writes, Cowork reads

```json
{
  "version": 1,
  "writtenAt": "2026-08-26T14:02:00Z",
  "requests": [
    {
      "id": "req-2026-08-26-netflix-fairhaven",
      "subscriptionId": "sub-netflix-fairhaven",
      "serviceId": "netflix",
      "serviceName": "Netflix",
      "householdName": "Fairhaven",
      "action": "pause",
      "method": "cancel-resubscribe",
      "manageUrl": "https://www.netflix.com/cancelplan",
      "approved": true,
      "approvedAt": "2026-08-26T14:01:44Z",
      "resumeBy": "2026-11-01",
      "notes": "Annual term, forfeits four months."
    }
  ]
}
```

`action` is `pause` or `resume`. `method` mirrors `PauseMethod` in `lib/types.ts`
and tells the playbook which flow to walk.

**`approved` is the gate and it is load-bearing.** Cowork skips any request where
`approved` is not exactly `true`. Execution runs unattended; the decision does not.
Cowork's `approvedPermissions` are sticky and persist across runs, so without this
field a scheduled run could cancel a subscription nobody chose to cancel.

### `data/pause-results.json` - Cowork writes, the app reads

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

`outcome` is one of:

| value | meaning |
|---|---|
| `done` | the flow completed and a confirmation was read |
| `already` | the subscription was already in the requested state |
| `blocked` | the flow needs a human - a CAPTCHA, a re-auth, an unexpected screen |
| `failed` | the flow was attempted and did not complete |
| `skipped` | not approved, or the playbook refused on its own stop-loss rule |

**`done` requires evidence.** A result claiming `done` must carry the confirmation
text the agent actually read. An agent that clicked a button and assumed is
reporting `failed`, not `done`. The whole product rests on never telling a family
they saved money they did not save.

## Rules the playbooks inherit

- **Never enter a password, a card number or any credential.** If a flow asks to
  re-authenticate, the outcome is `blocked` and a human takes over. No exceptions,
  including when the browser offers to fill it.
- **Never accept a retention offer.** These flows push a discount, a downgrade or a
  free month in place of cancelling. Taking one is a purchase decision the family
  did not authorise. Decline and continue, or report `blocked`.
- **One attempt per request per run.** A flow that fails does not get retried in the
  same run. Retrying a half-completed cancellation is how a household ends up with
  two cancellations or none.
- **Read the confirmation before claiming success.** See above.
- **Stop the whole run after two consecutive `blocked` or `failed` results.** A
  provider redesign breaks every request the same way, and grinding through the
  queue turns one stale playbook into ten wrong records.

## Nudge reminders

The same task shape carries the next feature set. `renewsOn` and `billingCycle` are
already on `Subscription`, and `upcomingRenewals()` in `lib/domain.ts` already reads
them. The content worth getting right is the boundary, not the reminder: cancelling
an annual plan mid-term forfeits the remainder, which `annual-term-forfeit` in
`PauseCost` already names. A nudge that fires on the wrong side of that boundary
costs money rather than saving it.
