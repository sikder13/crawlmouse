#!/usr/bin/env bash
# Runs a command and reports the most memory its whole process tree held at once: the build's
# compiler, its workers, the type checker and the linter together, sampled once a second. A single
# process's peak (`/usr/bin/time -v`) understates a build that forks, so both are printed.
#
# With BUILD_PEAK_BUDGET_MB set, the step fails when the tree's peak passes it, after the command
# itself has finished: the build's own exit status is kept and reported first.
#
# Usage: build-peak.sh <command> [args...]
set -uo pipefail

budget="${BUILD_PEAK_BUDGET_MB:-}"
interval="${BUILD_PEAK_INTERVAL_S:-1}"
timefile="$(mktemp)"

# Its own process group, so the sample sums every process the command starts and nothing else.
setsid /usr/bin/time -v -o "$timefile" "$@" &
pid=$!

peak_kb=0
while kill -0 "$pid" 2>/dev/null; do
  kb="$(ps -o rss= -g "$pid" 2>/dev/null | awk '{s += $1} END {print s + 0}')"
  if [ "$kb" -gt "$peak_kb" ]; then peak_kb="$kb"; fi
  sleep "$interval"
done
wait "$pid"
status=$?

peak_mb=$((peak_kb / 1024))
single_kb="$(awk -F': ' '/Maximum resident set size/ {print $2}' "$timefile")"
echo "build-peak: process tree peak ${peak_mb} MB (sampled every ${interval} s)"
echo "build-peak: largest single process ${single_kb:-?} KB (/usr/bin/time -v, Maximum resident set size)"
rm -f "$timefile"

if [ "$status" -ne 0 ]; then
  echo "build-peak: the command failed with exit status $status" >&2
  exit "$status"
fi
if [ -n "$budget" ] && [ "$peak_mb" -gt "$budget" ]; then
  echo "build-peak: ${peak_mb} MB is over the ${budget} MB budget" >&2
  exit 1
fi
