# Apple TV+ - what's different

Read `pausing.md` first. This is only the Apple TV+ part.

**Verification status: unverified, and the riskiest file here. Do not run this
unattended until a human has walked it.** Apple's subscription page is a
single list covering every subscription on the Apple ID, and a misread row
cancels somebody else's service. No selectors are recorded.

`method` in the catalogue: `cancel-resubscribe`. Apple sells no pause.

`manageUrl`: `https://apps.apple.com/account/subscriptions`

Domains: `apple.com`, `apps.apple.com`.

## It is a store page wearing a provider's name

Every Apple subscription is managed from one list. Nothing distinguishes Apple TV+
from a game, a weather app or another household member's subscription except the
row's own label.

**Read the row's name back before clicking anything in it**, and abort to
`blocked` if you cannot confidently identify the Apple TV+ row. Never act on a
row by position. This is the same failure that gets a rating attached to the wrong
employer, and here it cancels a stranger's subscription.

Arguably this service should carry `method: 'store-managed'` rather than
`cancel-resubscribe` - the mechanics are a store's, not a provider's. The
catalogue keeps `cancel-resubscribe` because there is no pause and stopping means
cancelling, which is what the method names. Worth settling on the walkthrough.

## Re-auth is the normal case, not the exception

Apple asks for the Apple ID password readily, and browser autofill will offer it.
**The moment a password field appears, the outcome is `blocked`.** Do not type,
do not accept a fill, do not dismiss and retry. Expect this to be the usual
outcome until a human establishes otherwise, and treat that as the playbook
working rather than failing.

## The annual term

The Northgate row is annual. `costs` records `annual-term-forfeit`: cancelling
mid-term throws away the remainder. Apple's page may or may not say so.

**Never let the absence of a warning read as the absence of a cost.** The family
already saw the forfeit in the app before approving, so proceed - but put the
term in `evidence` so the record shows what was given up. A nudge that fires on
the wrong side of this boundary costs money instead of saving it, and this result
is what teaches the app where the boundary was.

## Confirmation

Access runs to the end of the paid term. Read the date; it is `billingStopsOn`.
