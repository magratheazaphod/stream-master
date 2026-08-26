# Paramount+ - what's different

Read `pausing.md` first. This is only the Paramount+ part.

**Verification status: unverified. Do not run this unattended until a human has
walked it.** The mechanism is real - Paramount+ is genuinely sold as an Amazon
Prime Video channel and genuinely stops from there - but the page and its wording
are unseen and no selectors are recorded.

`method`: `store-managed`. This is the only `store-managed` service in the
catalogue and the whole reason the method exists.

`manageUrl`: `https://www.amazon.com/gp/video/settings/subscriptions`

Domains: `amazon.com`.

## Nothing on paramountplus.com can stop this billing

The household bought the channel through Amazon, so Amazon bills it and Amazon
ends it. A cancellation performed on the provider's own site would end an account
the household does not pay for and leave the charge running - a `done` that saves
nothing, which is the exact failure the evidence rule exists to prevent.

**If the queue's `manageUrl` for this request points at paramountplus.com,
something upstream is wrong. Report `skipped` and say so.** Trust `method` over
the service name.

## Which row

The Amazon channels page lists every channel the household subscribes to. Read
the row's name back before acting, the same discipline as Apple's list. A
mis-clicked row here cancels a different channel.

## Retention

Amazon's channel cancellation offers to keep access to the end of the period and
sometimes offers a discounted continuation. The first is fine and is how the
billing works. The second is a purchase decision - decline it.

## Confirmation

Read the sentence confirming the channel ends, and its date. Amazon's own
subscription list is a second source: a channel showing as ending on a date is
corroboration worth screenshotting alongside the confirmation.

## The annual row

Fairhaven's Paramount+ row is annual and carries no `lastUsedOn` - nobody has
answered the usage question. That is a gap in the record, not a licence to act on
it either way. The `approved` flag decides, as always.
