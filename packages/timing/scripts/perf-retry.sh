#!/usr/bin/env bash
# Runs the visual job's performance budgets, retries a failure once, and decides what a failure
# means. docs/ops/ci-timing.md states the rule; this is it, row for row:
#
#   attempt 1   attempt 2   runner probe     outcome                             exit
#   pass        -           -                passed                              0
#   fail        pass        -                flaky: passed on retry              0
#   fail        fail        normal/unknown   failed: reproduced                  1
#   fail        fail        slow             inconclusive: slow runner           0
#
# An inconclusive pass needs three things of the second attempt: a probe that rates the runner
# slow; at least one failed test, every one of them a budget test by its title (BUDGET_TITLE); and
# at least one reported error, every one of them the budget assertion itself (BUDGET_ERROR, the
# message perf.spec.ts gives `expect(missed)`). Any other error inside a budget test (a measurement
# marked MEASUREMENT INVALID, a canvas that never rendered, a test timeout) is not excused, nor is a
# failed trace control, a server that did not start, or a failure that names no test.
#
# Usage: perf-retry.sh <probe.json> -- <command...>
#   The command runs as given, then once more with --last-failed appended.
# Environment:
#   GITHUB_STEP_SUMMARY  the job summary to append to (optional)
#   FLAKE_ENTRY          where to write a flake register row when one is due (default flake-entry.md)
#   RUN_URL              the run link written into that row (optional)
set -uo pipefail

BUDGET_TITLE='within the budget'
BUDGET_ERROR='^ *Error: medians of [0-9]+ runs$'

probe_json=${1:?usage: perf-retry.sh <probe.json> -- <command...>}
shift
[ "${1:-}" = "--" ] || { echo "usage: perf-retry.sh <probe.json> -- <command...>" >&2; exit 2; }
shift
[ "$#" -gt 0 ] || { echo "perf-retry.sh: no command given" >&2; exit 2; }

summary=${GITHUB_STEP_SUMMARY:-/dev/null}
entry=${FLAKE_ENTRY:-flake-entry.md}
run_url=${RUN_URL:-this run}
logs=$(mktemp -d)

# Reads one field of the probe's JSON line, or "unknown" when the file is missing or unreadable.
probe_field() {
  node -e 'try { const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = r[process.argv[2]]; console.log(typeof v === "number" ? Number(v.toFixed(1)) : (v ?? "unknown")); } catch { console.log("unknown"); }' "$probe_json" "$1"
}

# The titles of the tests an attempt's list reporter marked failed, one per line.
failed_titles() {
  grep -E '^\s*✘' "$1" | sed -E 's/.* › //; s/ \([0-9.]+(ms|s|m)\)$//'
}

attempt() {
  local n=$1
  shift
  echo "::group::performance budgets, attempt $n"
  "$@" 2>&1 | tee "$logs/attempt-$n.log"
  local status=${PIPESTATUS[0]}
  echo "::endgroup::"
  {
    echo "<details><summary>Attempt $n: $([ "$status" -eq 0 ] && echo passed || echo failed)</summary>"
    echo
    echo '```'
    grep -F '[perf]' "$logs/attempt-$n.log" || echo '(no [perf] lines)'
    failed_titles "$logs/attempt-$n.log" | sed 's/^/failed: /'
    echo '```'
    echo
    echo '</details>'
  } >>"$summary"
  return "$status"
}

# A flake register row (docs/ops/ci-timing.md), for the PR author to commit.
register_row() {
  local tests
  tests=$(failed_titles "$logs/attempt-1.log" | paste -sd ';' - | sed 's/;/; /g')
  echo "| $(date -u +%F) | perf.spec.ts › ${tests:-(no failed test listed)} | $run_url | $1 |" >"$entry"
  {
    echo
    echo 'Flake register row (add it to docs/ops/ci-timing.md in this PR):'
    echo
    echo '```'
    cat "$entry"
    echo '```'
  } >>"$summary"
}

rating=$(probe_field rating)
probe_line="probe median $(probe_field medianMs) ms against reference $(probe_field referenceMs) ms (slow above $(probe_field limitMs) ms): $rating"
echo "### Performance budgets" >>"$summary"
echo "Runner $probe_line." >>"$summary"

if attempt 1 "$@"; then
  echo "Passed." >>"$summary"
  exit 0
fi

if attempt 2 "$@" --last-failed; then
  echo "::warning title=flaky: passed on retry::The performance budgets failed once and passed on retry; the job summary holds a flake register row."
  echo "**flaky: passed on retry.**" >>"$summary"
  register_row "passed on retry; $probe_line"
  exit 0
fi

failed=$(failed_titles "$logs/attempt-2.log")
errors=$(grep -E '^ *(Error: |Test timeout of )' "$logs/attempt-2.log")
if [ "$rating" = slow ] && [ -n "$failed" ] && ! grep -vqF "$BUDGET_TITLE" <<<"$failed" &&
  [ -n "$errors" ] && ! grep -vqE "$BUDGET_ERROR" <<<"$errors"; then
  echo "::warning title=inconclusive: slow runner::The performance budgets failed twice on a runner the probe rates slow ($probe_line). The strict nightly job holds the budgets."
  echo "**inconclusive: slow runner.** The strict nightly job holds the budgets." >>"$summary"
  register_row "inconclusive: slow runner; $probe_line"
  exit 0
fi

echo "::error title=performance budget::failed: reproduced on both attempts; $probe_line."
echo "**failed: reproduced** on both attempts ($probe_line)." >>"$summary"
exit 1
