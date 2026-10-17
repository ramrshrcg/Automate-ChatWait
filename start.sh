#!/bin/zsh
# One command: opens the workflow Chrome (if needed), starts the dashboard
# (if needed) and opens it. Prompt runs are started from the dashboard.
cd "${0:A:h}"
PORT=9222

if ! curl -s "http://localhost:$PORT/json/version" >/dev/null; then
  echo "Opening Chrome…"
  ./start-chrome.sh
  for i in {1..20}; do
    curl -s "http://localhost:$PORT/json/version" >/dev/null && break
    sleep 1
  done
  sleep 3  # let the chat tabs finish loading
fi

mkdir -p data
if ! pgrep -f "node dashboard.js" >/dev/null; then
  echo "Starting dashboard (log: data/dashboard.log)…"
  nohup node dashboard.js >> data/dashboard.log 2>&1 &
  for i in {1..15}; do
    curl -s http://localhost:4000/api/queue >/dev/null && break
    sleep 1
  done
fi

open http://localhost:4000
echo "Dashboard → http://localhost:4000   (click \"Run prompts\" to start)"
echo "Stop the dashboard later with: npm run stop"
