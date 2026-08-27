# Hulu - what's different

Read `pausing.md` first. This is only the Hulu part.

**Verification status: still unverified, and the walk on 2026-08-26 never reached
the account page.** It stopped at a credential wall, which is the correct outcome
and not a failure. Two things were learned on the way and both correct errors in
this file.

Everything below the "Not yet seen" heading remains inference. The ceiling
especially: the app stores it as `maxPauseMonths` and a wrong ceiling produces a
resume date the provider will not honour.

`method`: `native-pause`, still believed but unconfirmed. Would be the only
service in the catalogue where the app's verb is literally true - billing stops,
the account, profiles and watch history survive.

`manageUrl`: `https://secure.hulu.com/account`. Correct as an entry point, but it
redirects when signed out (see below).

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

## Not yet seen

Everything below this line is inference and none of it has been checked against
the current site. Treat it as a hypothesis to confirm on the next walk, not as a
description of the product.

## Why this one is the easy case

Nothing is lost, so `costs` is empty, so there is no retention argument to have.
Hulu wants the account back and the pause is how it keeps it. Expect a short flow
and treat a long one as a sign the page changed.

## The flow

1. Go to the account page. The pause control sits in the subscription block, not
   in the cancel flow - **do not enter the cancel flow looking for it.** If you
   find yourself on a page whose heading is about cancelling, back out.
2. Choose the pause length. **Never exceed the provider's own stated ceiling**, and
   never exceed the request's `resumeBy`: pause to the shorter of the two. Hulu
   resumes on its own at the end, so a pause longer than `resumeBy` bills the
   household for a month the app thinks is free, and one shorter merely resumes
   early.
3. Confirm.

## The ceiling is the thing that breaks

The pause length is offered as a set of choices, not a free date field. If the
choices on the day do not reach the request's `resumeBy`, take the longest
offered, record `done`, and **say the shortfall in `evidence`**. Do not report
`failed` - the pause happened - and do not report the requested date as if it were
achieved.

## Confirmation

The confirmation names the date billing resumes. That date is not
`billingStopsOn`, which is the date billing *stops* - for a native pause those are
different dates and conflating them puts a resume date in a stop field. Record the
stop date if the page names one, and put the resume date in the evidence sentence
where a human can read it.

## Resume

A `resume` request lifts the pause early from the same page. Hulu also lifts it on
its own at the ceiling, so a request that arrives after the pause already expired
is `already`, not `done` - and that needs the page saying the subscription is
active, not the absence of a pause control.
