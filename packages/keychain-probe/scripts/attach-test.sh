#!/usr/bin/env bash
# attach-test.sh — can lldb even attach to Lassen on this machine?
# Returns 0 on successful attach+detach, non-zero otherwise.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pid="$("$here/find-kindle-pid.sh")"
echo "attaching lldb to pid $pid ..."

# lldb batch mode: attach, confirm, immediately detach.
output=$(lldb --batch \
  -o "process attach --pid $pid" \
  -o "process detach" \
  -o "quit" 2>&1 || true)

echo "--- lldb output ---"
echo "$output"

# Heuristic: successful attach prints "Process <pid> stopped" or similar
if grep -qE '(Process [0-9]+ stopped|is stopped)' <<<"$output"; then
  echo
  echo "result: attach succeeded"
  exit 0
fi

# Common failure patterns
if grep -qE '(attach failed|Operation not permitted|is denied|unable to attach)' <<<"$output"; then
  echo
  echo "result: attach DENIED — AMFI / get-task-allow blocks debugger"
  echo "next: either enable amfi_get_out_of_my_way=0x1 boot-arg for a one-shot,"
  echo "      or try 'codesign --remove-signature' workaround (rarely works on arm64)"
  exit 2
fi

echo
echo "result: inconclusive, inspect output manually"
exit 3
