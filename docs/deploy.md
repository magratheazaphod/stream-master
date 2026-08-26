# Deploying to Vercel

Everything here assumes you have never used Vercel. Follow it top to bottom once
and the app is live behind the family password. After that, deploying is `git
push`.

## What you get

One URL, one password, the same view for all four households. There are no
accounts. The password lives in Vercel as a scrypt digest, so nobody reading the
dashboard - including anybody you later add to the project - can sign in with
what they see there.

The deployed app reads real household spend out of **Postgres**, provisioned
from the Vercel Marketplace and injected into every environment. Nothing real is
in the repository and nothing real reaches the build: `data/family.json` is
gitignored, it is the machine-local copy, and `npm run db:import` is what carries
it into the database. The masthead says which dataset is on screen either way,
which is the point of that badge - a deployment with no database configured
still runs on the invented demo dataset and says so.

## 1. Generate the two secrets

Run this on your laptop, in the repo:

```
npm run auth:hash
```

It asks for the family password, reads it off stdin so it never lands in your
shell history, and prints two lines. Keep the terminal open - you are about to
paste both into a browser.

Pick a password of at least twelve characters, and prefer four unrelated words.
Read "The rate limit" below before you choose something shorter.

## 2. Connect the repository

1. Push the branch to GitHub.
2. Go to vercel.com, sign in with GitHub, and choose **Add New -> Project**.
3. Pick `stream-master` from the repository list and press **Import**.
4. Vercel detects Next.js on its own. Leave the build command, output directory
   and install command exactly as it found them. This project needs no
   `vercel.json` and no `vercel.ts`; a config file you do not need is a config
   file that goes stale.
5. Do not press Deploy yet. Set the environment variables first - a deploy
   without them builds fine and then refuses every request, which is correct
   behaviour and a confusing first impression.

## 3. Set the environment variables

In **Settings -> Environment Variables**, add three. Tick Production, Preview and
Development for each unless a row says otherwise. The Postgres variables are not
in this table: the Marketplace integration writes them itself, into every
environment, and there is nothing to paste.

| Variable | What to put in it |
| --- | --- |
| `FAMILY_PASSWORD_HASH` | The `scrypt$...` line from `npm run auth:hash`. Paste the whole thing, dollar signs included. Never the password itself. |
| `SESSION_SECRET` | The other line from `npm run auth:hash`. At least 32 characters. It signs the session cookie and has nothing to do with the password: rotating it signs everybody out and leaves the password working. |
| `TMDB_READ_ACCESS_TOKEN` | The v4 read access token from themoviedb.org/settings/api, under "API Read Access Token". The long JWT-looking one, not the shorter v3 `api_key` - the watch-provider endpoints reject the v3 scheme outright. |

Then press **Deploy**.

If either auth variable is missing or malformed, every route returns 503 with a
message naming the variable. That is deliberate. An auth gate that falls back to
open on a missing variable is worse than no gate, because it looks locked.

Copy the same three into `.env.local` on your laptop, which is gitignored, or run
`vercel env pull` - which brings the Postgres variables down too. **Run `npm run
env:fix` after any pull.** The pull strips the escaping the password digest needs
and the gate then refuses every request.

## 4. Check it

Open the production URL. You should land on the sign-in screen. Type the
password. You should land on the dashboard with a "Demo data" badge.

Two things to try, because both are load-bearing:

- Open the URL in a private window and request `/api/lookup?q=dune` directly.
  You should get `401` and a JSON body, not a sign-in page. API routes never
  redirect to HTML.
- Press a Pause button. You should get a plain message saying nothing was
  recorded and nothing was queued. See "What does not work on Vercel" below.

## The rate limit, honestly

Sign-in attempts are limited to eight per IP per fifteen minutes, held in memory
in the serving process. That is a speed bump and nothing more:

- It resets on every redeploy.
- It does not span serverless instances. Vercel runs several, and a new cold
  instance starts with a fresh budget.
- An attacker who spreads attempts across instances effectively has no limit.

So it slows a casual attacker and does not stop a determined one. **The password
is the actual defence.** Four unrelated words is out of reach of any wordlist;
`familypass` is not, and no rate limiter here will save it.

The upgrade is a shared counter - Upstash Redis from the Vercel Marketplace, or
the database this project is heading towards anyway. It is deliberately not a
dependency today.

## What still needs a machine at home

**Pause and resume work on Vercel.** The write goes to Postgres, the request goes
to the `pause_requests` table, and both survive the function that wrote them. A
deployment with no connection string configured still refuses before writing,
with a message saying nothing was recorded and nothing was queued, because a
button that silently fails is the worst outcome this product can produce.

**Execution still happens on Jesse's Mac.** Cowork drives a signed-in browser and
no server has one, so `npm run pause:sync` carries approved requests down into
`data/pause-queue.json` and pushes results back up. Cowork's file contract is
unchanged and it never learns a database exists. See `docs/pause-automation.md`.

The consequence is on screen. A pause requested while the Mac is asleep reads
`Requested, not picked up` until the sync job runs, and `With the agent` after.
The family can tell the two apart, which is the whole reason the states are
separate.

## Preview deploys versus production

Every push to `main` deploys to production, at your real domain.

Every push to any other branch deploys to a **preview**, at its own generated URL
like `stream-master-git-tmdb-availability-jesse.vercel.app`. Pull requests get a
comment with the link. Previews are useful and they carry one trap worth naming:

- A preview is a full deployment on the public internet. It is gated by the same
  password, because middleware runs on every deployment, but the URL is
  guessable-ish and the gate is the only thing between it and a stranger.
- Preview environment variables are set separately from production in the
  dashboard. If you tick only Production when adding `FAMILY_PASSWORD_HASH`, every
  preview returns 503 and you will spend twenty minutes wondering why.
- Vercel offers **Deployment Protection** in Settings, which puts Vercel's own SSO
  in front of preview URLs. On Hobby it covers previews only. Turning it on is
  cheap and worth it - two locks on a page listing four households' spend is the
  right number.

## The Hobby tier

Hobby is free and **non-commercial**. Vercel's fair use terms mean it is for
personal projects, and a family tool that tracks your own subscriptions is
squarely inside that. The moment this app is sold, used by a business, or carries
advertising it needs a Pro plan. It also means no team members on the project -
Hobby is a personal account, so Jesse owns the deployment and shares the URL and
the password rather than dashboard access.

Practical limits that matter here: the app is one page and two API routes with
near-zero traffic, so nothing on Hobby's bandwidth or function-invocation budget
is in play. Node 24 is the default runtime and the default function timeout is
300 seconds, both far beyond what a TMDB lookup needs.

## The database

Databases come through the **Vercel Marketplace** now, not a first-party Vercel
Postgres product - that no longer exists. Supabase is on the Marketplace, so the
step is: **Storage -> Marketplace -> Supabase**, provision from inside the Vercel
project, and Vercel injects the connection variables into every environment
itself. There is no connection string to copy around by hand and no separate
Supabase project to keep in sync.

That is done. The app reads through a seam in `lib/store/`: a connection string
means Postgres, its absence means `data/family.json`, and `lib/catalog.ts` cannot
tell which it got. `STREAM_MASTER_STORE=file` forces the file path for local
work.

Two commands carry the data. `npm run db:import` loads `data/family.json` into
Postgres and is idempotent, so running it after an edit updates the rows rather
than duplicating them. `npm run db:seed` populates the provider directory.
Neither needs `psql` and both read the connection from `.env.local`.
