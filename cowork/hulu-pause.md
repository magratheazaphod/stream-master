# Hulu - what's different

Read `pausing.md` first. This is only the Hulu part.

**Verification status: verified up to the confirmation, 2026-08-26.** The account
page, the pause page, the ceiling, the billing rule and both control labels were
read on the day. Nothing was confirmed - the walk stopped one control short - so
the confirmation screen and the resume flow remain unseen.

The first walk that day stopped earlier still, at a credential wall, which is how
the MyDisney finding below was made.

`method`: `native-pause`, **confirmed**. The only service in the catalogue where
the app's verb is literally true: billing stops, the account, its profiles and its
history survive.

`manageUrl`: `https://secure.hulu.com/account`. Correct as an entry point. Signed
in it redirects to `secure.hulu.com/commerce/account?pinned=true`; signed out it
redirects to the login wall below.

## Authentication is MyDisney, not Hulu - verified 2026-08-26

`secure.hulu.com/account` redirected to `auth.hulu.com/web/login/enter-email`,
which renders a **MyDisney** card, not a Hulu one:

> Log in to Hulu with your MyDisney account. If you don't have one, you will be
> prompted to create one.

The page carries Disney, ABC, ESPN, Marvel, Star Wars, Hulu and National
Geographic marks, and says Hulu is part of The Walt Disney Family of Companies.

**Domains: `hulu.com`, `secure.hulu.com`, `auth.hulu.com`, and whatever MyDisney
redirects through.** The old list of the first two was wrong. A task allowlisted
to them alone gets redirected somewhere it may not open and stalls without a
useful error, which reads as a broken playbook rather than a scoping mistake.

The federation is also a reason to doubt the billing assumption. A MyDisney login
is consistent with Hulu having moved under Disney billing, in which case the
`manageUrl` and possibly the `method` belong to Disney+ rather than Hulu. Settle
that on the account page before trusting either.

## No signed-in session is a hard stop

The walk found Chrome not signed into Hulu. Report `blocked` and stop.

This is the whole mechanism failing safe. Cowork's value is that it drives an
already-authenticated browser and never handles a credential, so no session means
no mechanism. Never type an address into the email field, never continue into a
password screen, and never accept a browser autofill offer.

A human signs in, then the run is retried. There is no version of this an agent
solves on its own.

## The flow - verified 2026-08-26

`secure.hulu.com/account` redirects to `secure.hulu.com/commerce/account?pinned=true`
when signed in. The account page carries **two separate controls**, in this order:

- `Pause your subscription` -> `Pause`
- `Cancel your subscription` -> `Cancel`

Pause is its own control and **not** inside the cancel flow. If you find yourself
on a page headed about cancelling, back out - you took the wrong one.

`Pause` opens `secure.hulu.com/commerce/pause`, headed **"Need a break? Schedule a
pause."** That URL carries a `subscriptionId` query parameter which is specific to
the account. **Navigate to it from the account page. Never hardcode it**, and never
copy one account's link into another's run.

The page holds one dropdown, defaulting to `1 week`, and one control labelled
**`Pause Subscription`**.

## The ceiling is 12 weeks, and the unit is the problem

Verbatim:

> Instead of canceling, schedule a pause. You can pause your subscription for up
> to 12 weeks beginning on your next billing date. While your subscription is
> paused, you won't be billed, and you won't be able to watch videos. You can log
> in to resume or cancel anytime.

**12 weeks is 84 days. Three months is about 91.** The app stores this as
`maxPauseMonths`, an integer count of months, and there is no value that says 12
weeks. Storing `3` overstates the ceiling by a week and produces exactly the
failure this playbook was written to prevent: a resume date the provider will not
honour.

Until the model carries weeks, **store `2` and treat it as a floor, not a fact.**
Losing four days of eligible pause is the cheap error. Promising a date Hulu will
not meet is the expensive one.

## A pause starts at the next billing date, not now

This is the sharpest divergence from both Netflix flows and it changes what the
dates mean.

Pausing does nothing today. The household keeps watching until the next billing
date, and only then does billing stop. So `billingStopsOn` is **the next billing
date**, which the account page names under "Upcoming Charge" - not the day the run
executed, and not a date computed from anything else.

Read that date off the account page **before** entering the pause flow, because
the pause page does not repeat it.

## Choosing the length

The dropdown offers weeks, not a free date field. Pick the longest option that
does not overshoot the request's `resumeBy`, and never exceed 12 weeks.

Hulu resumes on its own at the end, so a pause longer than `resumeBy` bills the
household for time the app believes is free, and one shorter merely resumes early.
Err short.

If the longest option available does not reach `resumeBy`, take it, record `done`,
and **say the shortfall in `evidence`**. Do not report `failed` - the pause
happened - and never report the requested date as if it were achieved.

## Confirmation

Before confirming, the page states the resume date directly:

> Your subscription will resume on `<date>`. Don't worry, we'll email you when
> your subscription is set to resume.

That is the **resume** date, not `billingStopsOn`. For a native pause those are
different dates and conflating them puts a resume date in a stop field. Put the
resume date in the evidence sentence where a human can read it.

Hulu also emails before it resumes, which is a nudge the family gets for free.
Worth knowing when the reminder feature lands - do not build a second one.

## What the household loses

`costs` stays empty, and that is right in the model's terms: nothing is destroyed.
The account, its profiles and its history all survive, which is what separates a
pause from a cancellation.

But the page is explicit that **"you won't be able to watch videos"** while paused.
That is inherent to pausing rather than a Hulu quirk, so it needs no `PauseCost` -
it does need saying to anyone who assumes a pause only stops the money.

## Not yet seen

Everything below this line is inference. The confirmation screen after
`Pause Subscription`, and the resume flow, have not been walked.

## Resume

A `resume` request lifts the pause early from the same page. Hulu also lifts it on
its own at the ceiling, so a request that arrives after the pause already expired
is `already`, not `done` - and that needs the page saying the subscription is
active, not the absence of a pause control.
