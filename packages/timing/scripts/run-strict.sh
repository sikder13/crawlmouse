#!/usr/bin/env bash
# The strict unit timing run: every test file that imports @crawlmouse/timing, with PERF_STRICT=1,
# one file at a time so no other test shares the machine with a measurement. Run from the repo root
# (`pnpm perf:strict`). Fails when no file is found, so a run that measured nothing cannot pass.
set -uo pipefail

export PERF_STRICT=1
status=0
found=0
for pkg in packages/*; do
  [ "$pkg" = packages/timing ] && continue
  mapfile -t files < <(grep -rlE "from '@crawlmouse/timing'" "$pkg/src" --include='*.test.ts' 2>/dev/null | sort)
  [ "${#files[@]}" -eq 0 ] && continue
  found=$((found + ${#files[@]}))
  name=$(node -p "require('./$pkg/package.json').name")
  echo "== $name: ${#files[@]} file(s), PERF_STRICT=1"
  (cd "$pkg" && pnpm exec vitest run --fileParallelism=false "${files[@]#"$pkg/"}") || status=1
done
if [ "$found" -eq 0 ]; then
  echo "run-strict.sh: no test file imports @crawlmouse/timing" >&2
  exit 1
fi
exit "$status"
