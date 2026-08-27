# Disney+ - what's different

Read `pausing.md` first. This is only the Disney+ part.

**Verification status: unverified. Do not run this unattended until a human has
walked it.** The method is settled - Disney+ sells no pause - but the account
surface, the bundle handling below and the exact wording are unseen. No selectors
are recorded here.

`method`: `cancel-resubscribe`.

`manageUrl` in the demo catalogue:
`https://www.disneyplus.com/account/subscription`. **Attempted 2026-08-26 and it
did not resolve.**

Both `disneyplus.com/account` and `disneyplus.com/account/subscription` redirect
to `disneyplus.com/commerce/...` and render:

> Sorry, an unexpected error has occurred. Please try again later.

Neither redirected to a sign-in page, so this is an authenticated failure rather
than a missing session - a signed-out account gets the login wall instead, the way
Hulu did. Whether the cause is a transient Disney outage, or an account whose
billing lives with a third party that Disney's own commerce surface cannot render,
is **unknown**. Two URLs were tried and the walk stopped there rather than
grinding.

So the manage URL is not merely unverified, it is **known not to work today**. An
agent sent to it lands on an error page with no controls, which is `blocked` and
must never be read as "no subscription found".

Domains: `disneyplus.com`, `disney.com`.

## The bundle, which is the thing to get right

Disney+ is commonly billed as part of a bundle with Hulu and ESPN. Cancelling the
bundle stops all three, and the app's queue names one service.

**If the subscription block shows a bundle rather than a standalone Disney+ plan,
report `blocked`.** Say in `evidence` which services the bundle covers. Stopping a
household's Hulu because the queue asked about Disney+ is not a partial success,
it is the worst outcome this task can produce - the family loses a service nobody
discussed and the app records a saving against the wrong row.

Fairhaven carries both Disney+ and, elsewhere in the catalogue, Hulu. Check.

## What the household loses

`costs` records `grandfathered-price`: resuming lands on the current rate, and a
household below it pays more to come back than it pays now. That is a real cost
and it grows with the length of the pause, so a Disney+ pause is worth being
quick about.

## Retention

Expect an offer to switch to the ad-supported tier, and expect a "keep watching
until <date>" framing that reads like a confirmation and is not one. Decline the
offer. Do not stop reading at the framing.

## Confirmation

Access continues to the end of the paid period. Read the sentence that confirms
the cancellation, not the one that reassures about access.
