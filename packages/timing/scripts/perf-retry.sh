#!/usr/bin/env bash
# Runs the visual job's performance budgets, retries a budget failure once, and decides what a
# failure means. docs/ops/ci-timing.md states the rule; this is it, row for row:
#
#   attempt 1          attempt 2          runner probe     outcome                         exit
#   pass               -                  -                passed                          0
#   fail, other        - (no retry)       -                failed: not a budget failure    1
#   fail, budget only  pass               -                flaky: passed on retry          0
#   fail, budget only  fail               normal/unknown   failed: reproduced              1
#   fail, budget only  fail, other        slow             failed: reproduced              1
#   fail, budget only  fail, budget only  slow             inconclusive: slow runner       0
#
# "Budget only" (budget_only below) means one reported error per failed test, every one of them
# the budget assertion itself (BUDGET_ERROR, the message perf.spec.ts gives `expect(missed)`, which
# only a budget test has). Errors are read, colour codes stripped, from the lines Playwright starts
# with an error's name (`Error:`, `TypeError:`, `Error [ERR_...]:`, ...) or with `Test timeout of`.
# So "other" is any other failure: a measurement marked MEASUREMENT INVALID, a canvas that never
# rendered, a thrown error, a test timeout, a failed trace control, a server that did not start, a
# failure that names no test. Attempt 1 is read before any retry, so none of those is retried, and
# the retry (`--last-failed`) re-runs only the budget tests that failed.
#
# Usage: perf-retry.sh <probe.json> -- <command...>
#   The command runs as given, then once more with --last-failed appended.
# Environment:
#   GITHUB_STEP_SUMMARY  the job summary to append to (optional)
#   FLAKE_ENTRY          where to write a flake register row when one is due (default flake-entry.md)
#   RUN_URL              the run link written into that row (optional)
set -uo pipefail

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

# A log without its colour codes: Playwright's workers print with FORCE_COLOR=1, so a timeout
# line, for one, arrives coloured even in CI.
plain() {
  sed -E 's/\x1b\[[0-9;]*m//g' "$1"
}

# The titles of the tests an attempt's list reporter marked failed, one per line.
failed_titles() {
  plain "$1" | grep -E '^\s*✘' | sed -E 's/.* › //; s/ \([0-9.]+(ms|s|m)\)$//'
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

# Whether every failure in an attempt's log is a budget assertion: one BUDGET_ERROR per failed
# test, and no other error. With no error at all, "$errors" reads as one empty line, which is not
# BUDGET_ERROR, so a failure that printed nothing is not budget only.
budget_only() {
  local failed errors budget_errors
  failed=$(failed_titles "$1")
  errors=$(plain "$1" | grep -E '^ *([A-Za-z]*Error( \[[^]]*\])?: |Test timeout of )')
  budget_errors=$(grep -cE "$BUDGET_ERROR" <<<"$errors")
  ! grep -vqE "$BUDGET_ERROR" <<<"$errors" && [ "$budget_errors" -eq "$(grep -c . <<<"$failed")" ]
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

if ! budget_only "$logs/attempt-1.log"; then
  echo "::error title=performance budget::failed: not a budget failure; attempt 1 failed on something other than a budget assertion, so it is not retried; $probe_line."
  echo "**failed: not a budget failure.** Attempt 1 failed on something other than a budget assertion, so it was not retried ($probe_line)." >>"$summary"
  exit 1
fi

if attempt 2 "$@" --last-failed; then
  echo "::warning title=flaky: passed on retry::The performance budgets failed once and passed on retry; the job summary holds a flake register row."
  echo "**flaky: passed on retry.**" >>"$summary"
  register_row "passed on retry; $probe_line"
  exit 0
fi

if [ "$rating" = slow ] && budget_only "$logs/attempt-2.log"; then
  echo "::warning title=inconclusive: slow runner::The performance budgets failed twice on a runner the probe rates slow ($probe_line). The strict nightly job holds the budgets."
  echo "**inconclusive: slow runner.** The strict nightly job holds the budgets." >>"$summary"
  register_row "inconclusive: slow runner; $probe_line"
  exit 0
fi

echo "::error title=performance budget::failed: reproduced on both attempts; $probe_line."
echo "**failed: reproduced** on both attempts ($probe_line)." >>"$summary"
exit 1
