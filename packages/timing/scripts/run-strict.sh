#!/usr/bin/env bash
# The strict unit timing run, from the repo root (`pnpm perf:strict`): each workspace package's
# *.test.ts and *.test.tsx files whose source imports @crawlmouse/timing directly, run with
# PERF_STRICT=1, one file at a time so no other test shares the machine with a measurement. A test
# that reaches the helper only through another file of its own is not found. Fails when no file is
# found, so a run that measured nothing cannot pass. `--list` prints the files and runs nothing.
set -uo pipefail

IMPORT="from ['\"]@crawlmouse/timing['\"]"
list_only=false
[ "${1:-}" = "--list" ] && list_only=true

export PERF_STRICT=1
status=0
found=0
for pkg in apps/* packages/* inngest scripts; do
  [ -f "$pkg/package.json" ] || continue
  [ "$pkg" = packages/timing ] && continue
  mapfile -t files < <(grep -rlE "$IMPORT" "$pkg" --include='*.test.ts' --include='*.test.tsx' \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist 2>/dev/null | sort)
  [ "${#files[@]}" -eq 0 ] && continue
  found=$((found + ${#files[@]}))
  if $list_only; then
    printf '%s\n' "${files[@]}"
    continue
  fi
  name=$(node -p "require('./$pkg/package.json').name")
  echo "== $name: ${#files[@]} file(s), PERF_STRICT=1"
  (cd "$pkg" && pnpm exec vitest run --fileParallelism=false "${files[@]#"$pkg/"}") || status=1
done
if [ "$found" -eq 0 ]; then
  echo "run-strict.sh: no test file imports @crawlmouse/timing" >&2
  exit 1
fi
exit "$status"
