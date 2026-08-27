# Netflix - what's different

Read `pausing.md` first. This is only the Netflix part.

**Verification status: partly verified.** The method, the URL and the
end-of-period billing rule below are settled and long-standing. The exact screen
sequence and button labels are **not verified against the current site** and no
selectors are recorded here on purpose. A human walks this flow once and records
the wording before the first unattended run.

`method`: `cancel-resubscribe`. Netflix sells no pause. Stopping billing means
cancelling the membership.

`manageUrl`: `https://www.netflix.com/cancelplan`

Domains: `netflix.com`.

## What the household loses

`costs` records `profiles` and `downloads`. Netflix holds a cancelled account's
profiles and viewing history for a limited window and then drops them, so a pause
that runs long is a pause that loses the kids' watch history. Downloads go at once.
This is why the app shows the cost before the button and why a request that comes
back `blocked` is not an emergency - the family already decided with this in front
of them.

## The flow

1. Go straight to `netflix.com/cancelplan`. Do not navigate in from the account
   page; the deep link is stable and skips a screen.
2. If it redirects to a sign-in page, the session is not logged in. **`blocked`,
   immediately.** Do not type anything into it, and do not let the browser fill it.
3. Netflix asks for a cancellation reason on the way out. It is optional where it
   appears - skip it. Do not compose one.
4. Confirm.

## Retention

Netflix's exit path offers a cheaper ad-supported plan rather than cancelling.
**That is a downgrade, not a pause, and it is a purchase decision.** Decline it.
If the flow will not proceed past the offer, report `blocked` and say which offer
appeared - a household on a grandfathered price wants to know it was offered.

## Confirmation

Billing runs to the end of the paid period, so the confirmation names a future
date rather than stopping immediately. Read that date; it is `billingStopsOn`.
The wording has historically been of the form "Your membership ends <date>". Copy
the sentence as it reads on the day rather than matching it against that phrasing
- a rephrase is not a failure, an absent date is.

If the page confirms cancellation but names no date, record `done` with the
evidence sentence and **leave `billingStopsOn` absent.** Do not compute it from
`renewsOn`.

## Resume

A `resume` request restarts the membership from the same account, inside the
window where Netflix still holds it. Past that window it is a new sign-up, which
means a payment method, which means **`blocked`**. If the restart page asks for
card details at all, stop there.
