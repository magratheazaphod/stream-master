#!/bin/sh
# Put `pause:sync` on a daily schedule, or move it once it is on one.
#
# The sync job is the only thing that can see both the database and the queue
# file, so nothing reaches Cowork until it runs. Before this existed the answer
# to "when does my cancellation get picked up" was "when Jesse remembers", which
# is not a service level.
#
# launchd and not cron, for one reason that matters: a Mac asleep at the
# scheduled minute runs a StartCalendarInterval job when it wakes. cron just
# misses it. A laptop that is shut at 07:30 is the normal case here, not the
# edge case, and a schedule that silently skips those days would make the SLA a
# fiction on exactly the days it is most needed.
#
# Re-runnable. It rewrites the plist and reloads, which is also how you move the
# time: edit RUN_HOUR and RUN_MINUTE and run it again.
#
# No secrets go in the plist. The job runs `tsx scripts/pause-sync.mts` with the
# repo as its working directory, and the script reads `.env.local` the way the
# app does.

set -eu

LABEL="com.jesse-day.stream-master.pause-sync"
RUN_HOUR="${RUN_HOUR:-7}"
RUN_MINUTE="${RUN_MINUTE:-30}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"

# Resolve node now rather than trusting launchd's PATH, which has almost nothing
# in it. nvm puts node under a version directory, so this is re-resolved on every
# install - a node upgrade means running this script again.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node is not on PATH. Install it, or run this from a shell where nvm is loaded." >&2
  exit 1
fi

TSX="$REPO/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "$TSX is missing. Run npm install first." >&2
  exit 1
fi

if [ ! -f "$REPO/.env.local" ]; then
  echo "No $REPO/.env.local, so the job would have no database to sync with." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$TSX</string>
    <string>scripts/pause-sync.mts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$RUN_HOUR</integer>
    <key>Minute</key><integer>$RUN_MINUTE</integer>
  </dict>
  <!-- Both streams kept. A sync that fails silently is a queue that stops
       moving while the screen still says a request is on its way. -->
  <key>StandardOutPath</key><string>$LOG_DIR/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$LABEL.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_END

# bootout before bootstrap, so a re-run replaces rather than stacks. The || true
# covers the first install, where there is nothing to remove.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed $LABEL"
echo "  runs daily at $(printf '%02d:%02d' "$RUN_HOUR" "$RUN_MINUTE"), and on wake if the Mac was asleep then"
echo "  repo   $REPO"
echo "  log    $LOG_DIR/$LABEL.log"
echo
echo "Run it once now:   launchctl kickstart -p gui/$(id -u)/$LABEL"
echo "Check it is there: launchctl print gui/$(id -u)/$LABEL | head -20"
echo "Take it off:       launchctl bootout gui/$(id -u)/$LABEL && rm $PLIST"
