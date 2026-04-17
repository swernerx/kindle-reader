#!/usr/bin/env bash
# fs-trace.sh — trace every file system operation the Kindle process
# performs. Simple interactive wrapper around fs_usage. Needs sudo.
#
# Workflow:
#   1. ./fs-trace.sh trace      # foreground, Ctrl-C to stop. Writes /tmp/kindle-fs.log
#      (while this runs, switch to Kindle and open a book / turn pages)
#   2. ./fs-trace.sh summary    # post-mortem analysis of the log
set -euo pipefail

LOG=/tmp/kindle-fs.log

case "${1:-}" in
  trace)
    echo "starting fs_usage -w -f filesys Kindle  →  $LOG"
    echo "switch to Kindle and do what you want to observe."
    echo "Ctrl-C here when done."
    # -w wide, -f filesys narrows to FS-related events, Kindle filters by process name
    sudo fs_usage -w -f filesys Kindle | tee "$LOG"
    ;;

  summary)
    if [[ ! -s "$LOG" ]]; then
      echo "log missing or empty: $LOG" >&2
      exit 1
    fi
    total="$(wc -l <"$LOG" | tr -d ' ')"
    echo "=== captured $total events ==="
    echo
    echo "=== top path prefixes touched ==="
    awk '{
      for (i=1; i<=NF; i++) {
        if (substr($i,1,1) == "/") {
          n = split($i, parts, "/")
          prefix = "/" parts[2] "/" parts[3] "/" parts[4]
          counts[prefix]++
          break
        }
      }
    } END {
      for (p in counts) printf "%8d  %s\n", counts[p], p
    }' "$LOG" | sort -rn | head -30
    echo
    echo "=== files under Lassen container (sample) ==="
    grep -oE "/Users/[^ ]*com\.amazon\.Lassen[^ ]*" "$LOG" | sort -u | head -40
    echo
    echo "=== writes to /tmp or /var/folders ==="
    grep -E "WrData|open|rename" "$LOG" \
      | grep -oE '/(tmp|var/folders)/[^ ]*' | sort -u | head -40 || true
    echo
    echo "=== anything with 'key', 'voucher', 'drm' in the path ==="
    grep -iE "(key|voucher|drm)" "$LOG" | head -40 || true
    ;;

  *)
    echo "usage: $0 {trace|summary}" >&2
    exit 2
    ;;
esac
