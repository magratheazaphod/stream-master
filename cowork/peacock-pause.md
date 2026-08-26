# Peacock - what's different

Read `pausing.md` first. This is only the Peacock part.

**Verification status: unverified, including the method itself. Do not run this
unattended until a human has walked it.** The catalogue records
`method: 'native-pause'` with a two-month ceiling. **Do not treat that as a
finding.** Whether Peacock currently sells a pause at all, and what the ceiling
is, has not been checked, and the value in the demo catalogue is there to
exercise the second `native-pause` case in the UI.

`manageUrl` in the catalogue: `https://www.peacocktv.com/account/plans`. Also a
guess.

Domains: `peacocktv.com`.

## What the walkthrough has to settle first

Before anything else, answer one question: **does the account page offer a pause,
or only a cancellation?**

- **Pause offered.** Follow `hulu-pause.md`'s shape - pause to the shorter of the
  provider's ceiling and the request's `resumeBy` - and record the real ceiling
  back into `maxPauseMonths`.
- **Only cancellation.** **Stop. Report `blocked`.** Do not cancel. The family
  approved a pause that keeps the account, and a cancellation is a materially
  different decision with different costs - the empty `costs` array on this
  service was recorded for a pause that may not exist. Say in `evidence` that
  `method` needs changing to `cancel-resubscribe` and that `costs` needs
  rewalking, and leave the decision to a person.

That branch is the entire content of this playbook. Everything else is in
`pausing.md`.

## Confirmation

Whichever branch, read the sentence. A pause confirmation names a resume date; a
cancellation confirmation names an end-of-period date. They are different fields
and the wording is how you tell which one you got.
