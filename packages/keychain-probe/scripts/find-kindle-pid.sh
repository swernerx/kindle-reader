#!/usr/bin/env bash
# find-kindle-pid.sh — locate the running Lassen process and print its PID.
# Prefers the parent Kindle app process (not XPC helpers).
set -euo pipefail

# Prefer /Applications/Amazon Kindle.app/Contents/MacOS/Kindle
pid=$(pgrep -f '/Applications/Amazon Kindle.app/Contents/MacOS/Kindle' | head -1 || true)
if [[ -z "${pid:-}" ]]; then
  pid=$(pgrep -x Kindle | head -1 || true)
fi

if [[ -z "${pid:-}" ]]; then
  echo "error: Kindle process not found" >&2
  exit 1
fi

echo "$pid"
