# How long a pause takes

One governing question: somebody presses a button, when is the money actually
stopped, and how do they know?

## The answer today

**A request reaches an agent within 24 hours. Nothing is confirmed stopped,
because no agent is registered to act on it yet.**

That second sentence is the whole document. The schedule below is real and runs
daily. The thing it hands work to does not exist, so this is a service level on
half a chain, and saying otherwise would be the one lie this product cannot
tell.

## The chain, and what each link costs

| step | who | when |
|---|---|---|
| a household asks | the app | immediate |
| a second household agrees | the app | however long the family takes |
| the request reaches the queue file | `pause:sync` on the Mac | next 07:30, so **within 24 hours** |
| the flow is walked | Claude Cowork | **not scheduled - see below** |
| the result reaches the screen | `pause:sync` on the Mac | next 07:30 after the result is written |

Two households have to agree before the clock starts at all. Until then the
request is invisible to the sync job by design: `pause-sync` pulls
`where approved and handed_off_at is null`, and an unapproved request is neither.

## Why 24 hours and not five minutes

`pause:sync` is the only thing that can see both the hosted database and the
queue file Cowork reads, and it runs on Jesse's Mac. It is not reachable from
the internet, which is the arrangement the design chose on purpose: the app is
hosted so that a family member opens a URL, and Cowork is local because its
whole mechanism is a signed-in browser session.

So the floor on pickup is however often that Mac runs the job. Daily is the
cadence the family asked for, and it fits what this actually is - nobody cancels
a subscription that has to stop within the hour.

The job runs under launchd rather than cron for one reason: a Mac asleep at
07:30 runs the job when it wakes, where cron would skip the day silently. A shut
laptop is the normal case, not the edge case.

## The round trip is two days, not one

Worth stating plainly, because it is the least obvious number here.

One run does both directions: it pulls approved requests out and pushes results
back, in that order. So with a single daily run, a result Cowork writes today is
not on the family's screen until tomorrow's run.

- Approved Monday 10:00
- Handed to the agent Tuesday 07:30
- Walked by Cowork Tuesday, whenever its own schedule lands
- Confirmed on screen Wednesday 07:30

**Up to 48 hours from agreeing to seeing it confirmed.** A second run in the
evening would halve it. That is one line in
`scripts/install-sync-schedule.sh` and has not been done, because one run a day
is what was asked for and the difference only matters once something is
executing at all.

## What the screen says while this happens

The vocabulary is deliberate and none of it claims money stopped:

- **Waiting on a second household** - one person asked, nothing is queued.
- **Requested, not picked up** - agreed, and the sync job has not run yet.
- **With the agent** - `handed_off_at` is stamped and it is in the queue file.
- **Billing stopped** - a `done` result carrying confirmation text an agent read
  on the provider's page. This is the only state that says the money stopped, and
  it is the only one that requires evidence.

A `done` with no evidence reads **Reported done, no evidence**, not confirmed.

## What is missing before this is a service level

1. **No Cowork task is registered.** Nothing reads the queue file. This is the
   gap that keeps the table above from having a real number in its fourth row.
2. **No provider flow has been walked end to end.** Hulu and Disney+ have
   verified playbooks; five of seven do not, and no pause has ever run the whole
   chain.
3. **No supervised first run.** The order the ops skill sets out is: walk a flow
   by hand, register the task, then run the whole thing once with a human
   watching. None of that is done.

Until those three land, the honest promise is the one at the top: a request
reaches an agent within 24 hours, and nothing is confirmed stopped.

## Changing the schedule

```
npm run sync:schedule                     # install, or move it after editing the hour
RUN_HOUR=19 RUN_MINUTE=0 npm run sync:schedule
launchctl kickstart -p gui/$(id -u)/com.jesse-day.stream-master.pause-sync
```

The log is `~/Library/Logs/com.jesse-day.stream-master.pause-sync.log`. A sync
that fails silently is a queue that stops moving while the screen still says a
request is on its way, so both streams go to that file.
