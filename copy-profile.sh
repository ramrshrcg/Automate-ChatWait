#!/bin/zsh
# One-time copy of an existing Chrome profile (logins, extensions, last tabs)
# into the workflow profile used by start-chrome.sh.
# Usage: ./copy-profile.sh ["Default" | "Profile 1" | ...]
set -e
SRC_ROOT="$HOME/Library/Application Support/Google/Chrome"
DEST_ROOT="$HOME/.chatwait-workflow-profile"
PROFILE="${1:-Default}"

if [[ ! -d "$SRC_ROOT/$PROFILE" ]]; then
  echo "No Chrome profile named \"$PROFILE\" in $SRC_ROOT"
  exit 1
fi

if pgrep -x "Google Chrome" >/dev/null; then
  echo "Quit Chrome completely first (Cmd+Q on every Chrome window), then run this again."
  exit 1
fi

echo "Copying \"$PROFILE\" → $DEST_ROOT/Default (caches skipped)…"
mkdir -p "$DEST_ROOT"
rsync -a --delete \
  --exclude 'Cache' --exclude 'Code Cache' --exclude 'GPUCache' \
  --exclude 'Service Worker/CacheStorage' --exclude 'DawnCache' \
  --exclude 'Singleton*' \
  "$SRC_ROOT/$PROFILE/" "$DEST_ROOT/Default/"
cp "$SRC_ROOT/Local State" "$DEST_ROOT/Local State"
echo "Done. Start it with: npm run chrome"
