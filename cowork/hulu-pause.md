# Hulu - what's different

Read `pausing.md` first. This is only the Hulu part.

**Verification status: partly verified.** Hulu genuinely sells a pause with a
ceiling measured in weeks, and that is the fact the playbook turns on. The screen
sequence, the control's label and the exact ceiling on the day are **not verified
against the current site**. A human walks this once and records both before the
first unattended run - the ceiling especially, because the app stores it as
`maxPauseMonths` and a wrong ceiling produces a resume date the provider will not
honour.

`method`: `native-pause`. The only service in the catalogue where the app's verb
is literally true: billing stops, the account, profiles and watch history survive.

`manageUrl`: `https://secure.hulu.com/account`

Domains: `hulu.com`, `secure.hulu.com`.

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
