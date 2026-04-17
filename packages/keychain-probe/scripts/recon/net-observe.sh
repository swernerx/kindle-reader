#!/usr/bin/env bash
# net-observe.sh — show which hosts the Kindle app is currently talking to,
# and (optionally) capture raw packet metadata for later analysis.
#
# Uses nettop (human-readable, per-process) and lsof (socket enumeration).
# Neither needs SIP changes. Some operations want sudo.
#
# Usage:
#   ./net-observe.sh live          # one-shot snapshot of active connections
#   ./net-observe.sh watch         # refreshing view (like htop), Ctrl-C to stop
#   ./net-observe.sh hosts 60      # collect for 60 s, print unique (remote) hosts
#   sudo ./net-observe.sh pcap 60  # capture TCP metadata to /tmp/kindle.pcap
set -euo pipefail

cmd="${1:-}"
dur="${2:-60}"

find_kindle_pid() {
  pgrep -f "/Applications/Amazon Kindle.app/Contents/MacOS/Kindle" | head -1
}

live() {
  pid="$(find_kindle_pid)"
  if [[ -z "$pid" ]]; then echo "Kindle not running"; exit 1; fi
  echo "Kindle pid=$pid"
  # nettop "samples" — -n suppresses name resolution, -P shows per-process
  nettop -n -P -l 1 -p "$pid" 2>/dev/null
  echo
  echo "--- sockets via lsof ---"
  # -nPi4 (no DNS, no port names, IPv4) -a AND -p <pid>
  lsof -nPi4 -a -p "$pid" 2>/dev/null | grep -E "ESTABLISHED|LISTEN" | head -40
}

watch_mode() {
  pid="$(find_kindle_pid)"
  if [[ -z "$pid" ]]; then echo "Kindle not running"; exit 1; fi
  exec nettop -n -P -p "$pid"
}

hosts() {
  pid="$(find_kindle_pid)"
  if [[ -z "$pid" ]]; then echo "Kindle not running"; exit 1; fi
  echo "observing Kindle (pid=$pid) for ${dur}s... (interact with the app)"
  tmp="$(mktemp)"
  # -P per-process, -l N loops N samples @ 1 s each
  nettop -n -P -p "$pid" -L "$dur" -x >"$tmp" 2>/dev/null
  # extract remote addresses from nettop rows
  grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" "$tmp" \
    | awk -F. '{print $1"."$2"."$3"."$4}' \
    | sort -u \
    | while read ip; do
        if [[ "$ip" == "127.0.0.1" ]] || [[ "$ip" =~ ^192\. ]] || [[ "$ip" =~ ^10\. ]] || [[ "$ip" =~ ^169\. ]]; then continue; fi
        host="$(dig +time=1 +tries=1 +short -x "$ip" 2>/dev/null | head -1 || true)"
        printf "%-16s  %s\n" "$ip" "${host:-'-'}"
      done | sort -u
  rm -f "$tmp"
}

pcap() {
  pid="$(find_kindle_pid)"
  if [[ -z "$pid" ]]; then echo "Kindle not running"; exit 1; fi
  out=/tmp/kindle.pcap
  echo "capturing ${dur}s of TCP metadata for pid=$pid → $out"
  # tcpdump for the pid isn't directly supported; use 'pktap' interface
  # on macOS which allows proc-filtering via -k signature.
  # Fallback: capture everything, filter in post.
  sudo timeout "$dur" tcpdump -i any -w "$out" -n \
    "tcp and (port 443 or port 80)" 2>/dev/null || true
  echo "done. capture: $out"
  echo "to inspect: tcpdump -r $out -n | grep <IP>"
}

case "$cmd" in
  live) live ;;
  watch) watch_mode ;;
  hosts) hosts ;;
  pcap) pcap ;;
  *) echo "usage: $0 {live|watch|hosts [dur]|pcap [dur]}" >&2; exit 2 ;;
esac
