# cowork/

The playbooks Claude Cowork reads to execute a pause. The app writes a queue, this
agent drives a logged-in Chrome, and it writes results back. `docs/pause-automation.md`
is the contract; these files are how the agent honours it.

Read `pausing.md` first. It is the spine and it carries everything common. The
per-service files carry only what their provider does differently.

## Why the playbooks live here

`~/.claude/skills/` is on Cowork's protected list and is unreachable from a Cowork
session by design. A playbook the agent cannot read is not a playbook, so these
live in the repo, in a folder the task is granted.

## Setting up the task

Grant exactly two folders:

- `/Users/Siwen/projects/stream-master/data/`
- `/Users/Siwen/projects/stream-master/cowork/`

**Not the repo root.** The agent has no business in `app/` or `lib/`, and a narrow
grant is the cheapest guard there is. `data/` is gitignored and holds real
household state; `cowork/` is committed and read-only in practice.

`chromeAllowedDomains`, per the services currently in the catalogue:

```
netflix.com
max.com
auth.max.com
play.max.com
hbomax.com
disneyplus.com
disney.com
hulu.com
secure.hulu.com
apple.com
apps.apple.com
amazon.com
peacocktv.com
```

Trim it to the services actually in the queue where you can. The list is a
capability, and an unused entry is a capability granted for nothing. Anything
outside it is `skipped`, never worked around.

The task prompt itself should be short: point at `cowork/pausing.md` by host path
and let the spine do the work. Prompt text lives in the task's own `SKILL.md`, not
in the metadata JSON - see the `claude-cowork` skill for where both sit on disk.

## Things that will bite you

- **Cowork cannot reach a host port.** `localhost:3200` does not exist from inside
  its VM. There is no API between the app and the agent and designing one wastes a
  day.
- **File tools run on the host, bash runs in the VM.** Same path, two meanings.
  Write every check as a `Read`.
- **A task still dispatches when its grants are gone**, and still records
  `lastRunAt`. The prompt's own pre-flight is the only real guard.
- **No git commands in this repo, ever.** They succeed without a network, against
  Jesse's real working tree, and the sandbox cannot clean up a lock file. The
  agent names what needs committing and a Claude Code session does it.

## Files

| file | what it covers |
|---|---|
| `pausing.md` | the spine: pre-flight, the `approved` gate, evidence, results, stop-loss |
| `netflix-pause.md` | cancel-only, ad-tier retention offer, end-of-period date |
| `max-pause.md` | the external-biller trap |
| `disneyplus-pause.md` | the bundle trap |
| `hulu-pause.md` | the only real pause, and its ceiling |
| `appletv-pause.md` | one store list for every subscription, and routine re-auth |
| `paramount-pause.md` | store-managed, settled on Amazon |
| `peacock-pause.md` | whether a pause exists at all is the open question |

Prime Video has no playbook because it has no `PauseTerms`. Nobody has walked it.
Absent terms are a gap, never a green light - the app offers no button and this
agent attempts nothing.

## Before the first unattended run

Every per-service file carries a verification status at the top. **Only Netflix
and Hulu are partly verified, and neither has its screen sequence recorded.** A
human walks each flow by hand once, records the wording, the real `manageUrl` and
any ceiling, and writes those back into `PauseTerms` with a fresh `verifiedOn`.

An unverified playbook run unattended does not fail safely. It clicks something.
