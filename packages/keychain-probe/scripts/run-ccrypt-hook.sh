#!/usr/bin/env bash
# run-ccrypt-hook.sh — attach lldb to the running Kindle process, install
# a CCCryptorCreate hook that logs all AES keys/IVs to /tmp/kindle-ccrypt,
# and keep the session alive until SIGINT.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pid="$("$here/find-kindle-pid.sh")"
echo "attaching lldb to PID $pid and installing CCCryptorCreate hook"
echo "interact with Kindle now (open books, turn pages, etc.)"
echo "logs go to /tmp/kindle-ccrypt/calls.log"
echo "press Ctrl-C to detach and stop"

exec lldb -p "$pid" \
  -o "command script import $here/hook_cccryptor.py" \
  -o "hook_ccrypt" \
  -o "continue"
