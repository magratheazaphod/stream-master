---
name: pause-walkthrough
description: Walk one provider's stop-billing flow with Jesse driving, and turn what you saw into a verified playbook and real PauseTerms. Use before any provider is trusted for unattended pausing, when a playbook is marked unverified, or when a Cowork run reports blocked because the screens changed.
---

# Walking a provider's pause flow

Every playbook in `cowork/` is speculation until somebody has seen the real screens.
This is how speculation becomes a record. It takes about fifteen minutes per provider
and it is the gate on the whole pause feature.

Read `cowork/pausing.md` and the provider's own playbook first. You are correcting a
document, not writing one from nothing.

## The rule that shapes everything

**Jesse clicks. You watch and write.** Not because automation is hard, but because
this walkthrough passes through the exact controls that cancel a real subscription
against a real account. A misread screen during a *recording* session costs a
subscription nobody meant to cancel.

So: you may read the page, take screenshots and ask what a control says. You do not
click Cancel, Confirm, Pause, or anything that changes billing state. Say which
control you believe is next and let Jesse decide.

## Before starting

Confirm all four, out loud:

1. **Which subscription**, by household and payer. Providers with several plans on one
   account make it easy to walk the wrong one.
2. **Whether Jesse intends to actually stop billing**, or only to record the flow.
   Both are valid and they end differently. A recording-only walk stops on the screen
   *before* the irreversible control and reads it rather than pressing it.
3. **Whether the plan is annual.** Cancelling mid-term forfeits the remainder, which
   `annual-term-forfeit` names in `PauseCost`. Say the number before anybody clicks.
4. **That this is Jesse's own account.** Never walk a flow on another household's
   login.

## What to record

The playbook needs what a future agent cannot guess. Six things:

- **The real entry URL.** The one that lands on the stop-billing screen, not the
  account homepage. Several playbooks carry guessed URLs and this is how they get
  fixed.
- **The screen sequence**, in order, each named by text actually on the page. Never a
  CSS selector inferred from nothing - if you did not read it off the DOM, do not
  write it.
- **The retention gauntlet.** What the provider offers to stop you: a discount, a
  downgrade, a free month, a pause offered only once you try to cancel. Record each
  and record how to decline it. **Accepting one is a purchase decision the family did
  not authorise**, so the playbook must name them to refuse them.
- **Whether a real pause exists**, and its ceiling in months. Some providers hide
  pause inside the cancel flow, which is why `method` is often wrong until somebody
  looks.
- **The confirmation text, verbatim.** This is what an agent must read back as
  evidence. Without it, `done` is unprovable and the whole chain is a claim rather
  than a record.
- **What is lost.** Downloads, profiles and their history, a saved list, a
  grandfathered price. These are the reasons people refuse to press the button, so
  the app says them out loud per service.

## Anything that asks for a credential ends the walk

A re-authentication prompt, a password field, a card confirmation, a CAPTCHA. Record
that it happened, at which step, and stop. **Never type a credential and never accept
a browser autofill offer.**

This is not an obstacle to route around. A flow that re-authenticates cannot run
unattended, and the correct playbook entry says `blocked` and hands to a human. An
agent hitting that is the design working.

## Writing it back

Three places, all of them:

1. **The playbook** in `cowork/<service>-pause.md`. Remove the unverified marker only
   if you saw every step. Partly walked stays partly marked - say which steps are
   real and which are still inferred.
2. **`PauseTerms`** for that service: `method`, `manageUrl`, `maxPauseMonths` where a
   native pause exists, `costs`, and `verifiedOn` as today's date. Real data lives in
   `data/family.json`, then `npm run db:import`. The demo catalogue in
   `lib/demo-data.ts` takes the same correction, since it is what a reader sees first.
3. **`docs/pause-automation.md`**, but only if the *contract* changed. A provider
   detail is not a contract change. A new outcome the results file cannot express is.

`verifiedOn` is the field that tells the app when to doubt itself. Never copy one
forward from an older entry.

## Then, and only then

- Register the Cowork task: grants on `data/` and `cowork/` only, never the repo root,
  and `chromeAllowedDomains` scoped to the providers actually walked.
- Run the full chain once with Jesse watching: press the button in the app, run
  `npm run pause:sync`, let Cowork act, confirm the result comes back with real
  evidence and the UI moves to "billing stopped".
- Only after that does anything run unattended, and only for the providers walked.

An unwalked provider stays unwalked. Seven playbooks with two verified is an honest
state. Seven playbooks all claiming to work is not.
