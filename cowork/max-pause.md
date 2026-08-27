# Max - what's different

Read `pausing.md` first. This is only the Max part.

**Verification status: unverified. Do not run this unattended until a human has
walked it.** Max has changed its name, its domain and its account surface more
than once, and this playbook records no screen sequence and no selectors because
none have been seen. What is below is the shape of the problem, not a script.

`method`: `cancel-resubscribe`. No pause.

`manageUrl` in the demo catalogue: `https://auth.max.com/account/subscription`.
**Treat the URL as a guess.** The walkthrough's first job is to record the URL
that actually reaches the stop-billing page, and to write it back to the service's
`PauseTerms` with a fresh `verifiedOn`.

Domains: `max.com`, `auth.max.com`, `play.max.com`, `hbomax.com`.

## The billing-channel trap, and it is the important one

Max is frequently bought **through a store** - Amazon Channels, Apple, Roku, a
cable provider - and a Max subscription bought that way **cannot be stopped on
max.com at all.** The account page says as much and sends the household to the
store.

If the account page names an external biller, the request's `method` is wrong.
**Report `blocked`**, name the biller in `evidence`, and say plainly that the
service's `PauseTerms` need `method` changed to `store-managed` and `manageUrl`
pointed at that store. Do not go and cancel it on the store instead: that store is
not in `chromeAllowedDomains`, and acting outside the allowlist is exactly the
thing the allowlist exists to stop.

Three households in the demo catalogue carry Max, one of them already paused. A
wrong biller assumption breaks all three the same way, which is precisely the case
the two-consecutive-failure stop-loss is for.

## What the household loses

`costs` records `downloads` and `watch-list`. The saved list does not survive, so
this is a pause a family notices even when the money is right.

## Retention

Expect an offer of the ad-supported tier or a discounted month. Decline both.

## Confirmation

Billing runs to the end of the paid period. Read the date off the confirmation.
No date, no `billingStopsOn`.
