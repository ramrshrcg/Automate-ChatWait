#!/bin/zsh
# Launches your real Google Chrome with a dedicated profile and a local
# debugging port, so queue.js can attach to it. Log in to the chat sites and
# install ChatWait in this window once; the profile is kept for next time.
PROFILE_DIR="$HOME/.chatwait-workflow-profile"
PORT="${PORT:-9222}"

open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE_DIR" \
  --remote-debugging-port="$PORT" \
  --no-first-run
