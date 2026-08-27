# Netflix - what's different

Read `pausing.md` first. This is only the Netflix part.

**Verification status: the extra-member branch is verified, walked 2026-08-26.
The plan-owner branch is not.**

The walk found something the plan did not anticipate and every claim below is
scoped by it: **Netflix shows a completely different flow depending on whether
the account owns the plan or sits on somebody else's as an extra member.** Same
URL, same product, different screens, different costs and a different billing
rule. An agent that assumes the owner flow will misread the extra-member one.

So the first job on this page is not to cancel. It is to work out which flow is
on screen, and refuse if it is the unwalked one.

`method`: `cancel-resubscribe`. Netflix sells no pause. Stopping billing means
cancelling the membership.

`manageUrl`: `https://www.netflix.com/cancelplan`

Domains: `netflix.com`.

## What the household loses

On the **plan-owner** flow, `costs` records `profiles` and `downloads`. Netflix
holds a cancelled account's profiles and viewing history for a limited window and
then drops them, so a pause that runs long is a pause that loses the kids' watch
history. Downloads go at once.

On the **extra-member** flow the page names only personalized recommendations,
which maps to `profiles`. But the real cost is the one `PauseCost` cannot yet
express: **getting back in depends on another person inviting you.** The app has
no vocabulary for a cost somebody else controls, and until it does, this playbook
carries the sentence and refuses to act rather than pretending the cost is
`profiles` and moving on.

This is why the app shows the cost before the button and why a request that comes
back `blocked` is not an emergency - the family already decided with this in front
of them.

## Step one - which flow is this

Go straight to `netflix.com/cancelplan`. Do not navigate in from the account
page; the deep link is stable and skips a screen. If it redirects to a sign-in
page the session is not logged in: **`blocked`, immediately.** Do not type
anything into it, and do not let the browser fill it.

Then read the paragraph under "Manage your membership" and branch on it.

- It names another person's account - "You can remove yourself as an extra member
  on `<somebody>`'s plan" - this is the **extra-member flow**, walked below.
- It does not, and the page offers to cancel a membership this account owns -
  this is the **plan-owner flow**, which nobody has walked. Report `blocked` and
  say so. Do not improvise from the extra-member steps; the billing rule alone
  differs.

## The extra-member flow - verified 2026-08-26

The page carries two collapsed panels, `Get your own plan` and `Cancel`. **Both
panels' text is already in the DOM before either is expanded**, so read the page
rather than clicking to reveal. That matters here: on this flow the panel headed
"Cancel" sits one control away from an irreversible action.

Verbatim, as read on the day:

> You can remove yourself as an extra member on `<owner>`'s plan, or get your
> own. Whatever you choose, it'll take effect immediately.

> Canceling your membership means losing access to personalized recommendations.
> You won't be able to return as an extra member unless someone invites you.

The final control is labelled **`Finish Cancellation`**. Not "Confirm".

**There is no cancellation-reason survey on this flow.** The older guidance said
to skip one. Do not go looking for it.

### It takes effect immediately

This is the sharpest divergence from the owner flow and from what this playbook
previously claimed. There is **no end-of-paid-period grace**. The moment the
control is pressed, access is gone.

So `billingStopsOn` is the day it ran, not a future date, and the safety net that
makes a mistaken cancellation survivable until the 1st **does not exist here**.

### Resume is not self-service - treat this as disqualifying

"You won't be able to return as an extra member unless someone invites you."

Coming back requires a **third party to act**. No credential, no payment method
and no amount of patience gets the household back on its own.

**Never action a `pause` on an extra-member Netflix row.** Report `blocked` with
that sentence as the evidence and let a human decide, every time. A rotation plan
that pauses this and cannot resume it has not saved money, it has lost the
household its access and made the fix somebody else's favour to grant.

## Retention

The offer is **not** the ad-supported downgrade the plan predicted. It reads:

> Instead of canceling, keep your preferences and get your own plan starting at
> $8.99 a month (pre-tax).

That is an **upsell to a new paid subscription**, not a cheaper version of an
existing one, and taking it starts billing that did not exist before. It is a
purchase decision the family did not authorise. Decline it. If the flow will not
proceed past it, report `blocked` and name the offer.

## The plan-owner flow - not walked

Long-standing behaviour, unverified against the current site: `cancel-resubscribe`,
billing runs to the end of the paid period, and the confirmation names a future
date of the form "Your membership ends `<date>`" which is `billingStopsOn`. If the
page confirms but names no date, record `done` with the evidence sentence and
**leave `billingStopsOn` absent** rather than computing it from `renewsOn`.

None of that has been seen. Until somebody walks it, this branch is `blocked`.
