---
name: stream-master-ops
description: Operating stream-master - deploying to Vercel, the two Supabase databases, running the scripts, and the traps that already cost hours. Read before any deploy, any migration, any script run, or when the app returns 503 or shows demo data unexpectedly.
---

# Operating stream-master

Everything here was learned by breaking it. Each trap below has already cost time
once, and every one of them fails quietly rather than loudly, which is why they are
worth writing down.

## Before anything: which data am I looking at

The masthead badge answers it. **Demo data** means invented households. **Family
data** means real household spend on screen.

Three outcomes and only three, in `lib/store/`:

| State | Result |
|---|---|
| Postgres configured | private data from the database |
| No connection, `data/family.json` present | private data from the file |
| Neither | demo data |
| Either present and malformed | throws, never degrades to demo |

A screenshot of real money mistaken for fiction is the worse of the two errors, which
is why both states carry a badge rather than only the demo one.

## Trap 1 - `.env.local` eats the password digest

**Symptom: every route returns 503 saying the gate is not configured.**

`FAMILY_PASSWORD_HASH` is `scrypt$N$r$p$salt$key`. A `.env` file expands `$NAME` as a
variable reference, **inside double quotes as well as bare**, so the separators get
eaten and the app receives a digest it cannot parse. The file looks right. The value
that arrives is not.

```
npm run env:fix
```

Idempotent, and it never prints the value. **Run it after every `vercel env pull`**,
which includes every `vercel integration add` - those pull automatically and undo the
escaping without saying so.

The Vercel dashboard does no expansion, so the value stored there stays unescaped.
Only the local file needs this.

## Trap 2 - the migrations ledger does not exist

Neither database has a `supabase_migrations.schema_migrations` table. Every migration
so far was applied by hand.

**`supabase db push` will try all of them from the top and fail on the first
`create type`.** Reconcile the ledger before using the CLI against hosted, or keep
applying by hand.

Applying by hand, which is the current practice:

```bash
C=supabase_db_stream-master
# local
docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<file>.sql
# hosted
URL=$(grep '^POSTGRES_URL_NON_POOLING=' .env.local | cut -d= -f2- | tr -d '"' | sed 's/\\\$/$/g')
docker exec -i "$C" psql "$URL" -v ON_ERROR_STOP=1 < supabase/migrations/<file>.sql
```

`psql` is not on the PATH. The Supabase container carries it, which is why every
command above goes through `docker exec`. That works for the hosted database too -
the container has outbound network.

## Trap 3 - a new table is public until you say otherwise

Supabase grants `anon` and `authenticated` INSERT, UPDATE, DELETE and TRUNCATE on new
tables in `public` by default. The publishable key carrying those roles ships to every
browser, and this project has no RLS by design.

That combination once left every availability table truncatable by anyone who opened
the page. **Every new table in `public` must revoke those grants in its own
migration.** Silence is a grant.

Verify after any schema change:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

The answer must be empty. No RLS is the deliberate posture - shared family visibility
is the feature - but it only holds while PostgREST cannot reach the tables at all.

## Trap 4 - middleware that compiles to nothing

Next 15.5.22 accepts `runtime: 'nodejs'` in the middleware config, compiles with no
warning, and emits an **empty `middleware-manifest.json`**. The app deploys with no
authentication at all and nothing errors.

**The middleware sets no runtime.** `middleware.test.ts` fails if anyone sets one.
Nothing in it needs Node: it verifies the cookie with Web Crypto, and every scrypt
operation happens in the Node-runtime `/api/auth`.

Revisit only when Next ships Node middleware in a stable release. Vercel's own
guidance says to avoid the edge runtime, and that guidance is right in general and
wrong for this version.

## Trap 5 - the Vercel CLI ignores `.gitignore`

It reads `.vercelignore` and nothing else. Before `.vercelignore` existed, one
`vercel` run from the laptop would have uploaded `data/family.json` - real household
spend - to a deployment. Keep it correct.

## Trap 6 - scripts do not load `.env.local`

Only Next does. `scripts/lib/env.mts` reads the file the way the app does, including
un-escaping what `env:fix` adds, and prefers the non-pooling URL.

**A variable exported in the shell wins outright.** An exported `POSTGRES_URL`
pointing at localhost once got outranked by the file's `POSTGRES_URL_NON_POOLING` and
seeded the hosted database instead. Harmless that time. Check `env | grep POSTGRES`
before running a script that writes.

## Trap 7 - `open -a Docker` can resolve to the Trash

If Docker Desktop was reinstalled, LaunchServices may still point at a copy in the
Trash, which cannot run and reports nothing useful. Launch it by full path:
`open /Applications/Docker.app`.

Homebrew's cask install needs `sudo` for `/usr/local/cli-plugins` and **deletes
`/Applications/Docker.app` when that fails**. Non-interactive shells cannot answer a
sudo prompt, so run cask installs in a real Terminal.

## The scripts

| Command | What it does |
|---|---|
| `npm run env:fix` | re-escape the digest after a `vercel env pull` |
| `npm run auth:hash` | generate `FAMILY_PASSWORD_HASH` and `SESSION_SECRET`, reading the password off stdin. Needs a real terminal, or pipe one in. |
| `npm run db:seed` | seed `providers` from the committed snapshot |
| `npm run db:import` | load `data/family.json` into Postgres. Idempotent, deletes what the file no longer mentions. |
| `npm run pause:sync` | the Mac-side job: pull approved requests into the queue file, push results back up |
| `npm run docs` | render the Markdown artifacts to HTML |

`npm run auth:hash` never takes the password as an argument, so it stays out of shell
history and the process list.

## Deploying

GitHub is connected: pushing `main` deploys production, any other branch gets its own
preview URL. `vercel --prod` deploys the working tree directly.

- **The first deploy of a project always goes to production**, whatever you asked
  for. Vercel says so in its output and it is easy to miss.
- Set every environment variable in **Production and Preview**. Production only makes
  every preview return 503.
- `.vercel.app` names are global across all Vercel users. `stream-master` and
  `streammaster` are both taken by strangers, which is why the real URL is a
  subdomain of `jesse-day.com`.
- A Cloudflare record for a Vercel domain must be **DNS only**, grey cloud. The
  orange-cloud proxy breaks certificate issuance and you get a TLS error rather than
  a site.
- The certificate lands roughly a minute after verification. A failed TLS handshake
  immediately after is normal, not a misconfiguration.

## Verifying a deploy without the password

The gate stops you at the door, which is correct. What can be checked from outside:

```bash
U=https://stream-master.jesse-day.com
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "$U/"          # 307 -> /signin
curl -s -o /dev/null -w "%{http_code}\n" "$U/signin"                        # 200
curl -s -o /dev/null -w "%{http_code}\n" "$U/api/lookup?q=NCIS"             # 401
curl -sI "$U/signin" | grep -iE "^strict-transport|^x-frame|^x-robots"      # headers present
```

Whether the app reads Postgres or fell back to demo data is **behind the password**
and cannot be verified from outside. Ask Jesse to check the masthead badge.

## The pause chain, and what is not built

`docs/pause-automation.md` is the contract. `cowork/` holds the playbooks. What
exists: the file contract both directions, the sync job, the app writing real
requests, and four honest UI states.

What does not exist, as of the last session:

- **No Cowork task is registered.** No schedule, no folder grants on `data/` and
  `cowork/`, no `chromeAllowedDomains`.
- **No provider flow has been walked.** Five of seven playbooks are marked unverified
  with no invented selectors. Netflix and Hulu are partly verified - the mechanism is
  known, the current screens are not.
- **Nothing schedules `pause:sync`.**
- **No pause has run end to end.**

Do not describe pausing as working. Walk one flow by hand first, then register the
task, then run the whole chain once with a human watching.
