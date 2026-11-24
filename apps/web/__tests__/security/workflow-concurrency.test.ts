import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Every workflow has a concurrency group (docs/specs/v2/ci-cost.md, D4). A newer run of the same
// ref cancels an older one, except where cancelling midway would leave something half done, and
// never a running run on main.

const WORKFLOWS = join(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..'),
  '.github/workflows',
);

const ON_MAIN_ITS_OWN =
  "${{ github.ref == 'refs/heads/main' && format('-{0}', github.run_id) || '' }}";

/**
 * ci.yml on main (Goal 1, CTO inbox 075): pushes share one group, so a newer merge replaces a PENDING run
 * and never a running one; the nightly run and a dispatch keep a group of their own.
 */
const MAIN_PUSHES_SHARE =
  "${{ github.ref == 'refs/heads/main' && github.event_name != 'push' && format('-{0}', github.run_id) || '' }}";

const EXPECTED: Record<string, { group: string; cancel: boolean | string; why: string }> = {
  'ci.yml': {
    group: `ci-\${{ github.ref }}${MAIN_PUSHES_SHARE}`,
    cancel: "${{ github.ref != 'refs/heads/main' }}",
    why: 'a newer push makes the older run of a branch moot; on main a newer push replaces only a pending run',
  },
  'nightly.yml': {
    group: `nightly-\${{ github.ref }}${ON_MAIN_ITS_OWN}`,
    cancel: true,
    why: 'a dispatch on a branch replaces the older one; on main nothing is cancelled',
  },
  'db-apply-prod.yml': { group: 'db-production', cancel: false, why: 'production' },
  'db-rollback-prod.yml': { group: 'db-production-rollback', cancel: false, why: 'production' },
  'db-dry-run.yml': {
    group: 'db-dry-run-${{ github.event.pull_request.number }}',
    cancel: false,
    why: 'a cancelled dry run leaves its Supabase branch behind',
  },
  'db-dry-run-cleanup.yml': {
    group: 'db-dry-run-cleanup-${{ github.event.pull_request.number }}',
    cancel: false,
    why: 'a cancelled clean-up leaves the Supabase branch it was deleting',
  },
  'worker-production.yml': {
    group: 'worker-production',
    cancel: false,
    why: 'a production deploy and its egress check; the owner dispatches it (CC-35 D1)',
  },
  'worker-staging.yml': {
    group: 'worker-staging',
    cancel: false,
    why: 'a cancelled deploy is half a deploy',
  },
};

const files = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

describe('workflow concurrency', () => {
  it('names every workflow in the repository, and only those', () => {
    expect(files).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(files)('%s has its group and its cancel rule', (file) => {
    const wf = parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as {
      concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string };
    };
    const want = EXPECTED[file]!;
    expect(wf.concurrency, want.why).toEqual({
      group: want.group,
      'cancel-in-progress': want.cancel,
    });
  });

  // Read from the files, not from the table above: a production database run is never cancelled.
  it.each(['db-apply-prod.yml', 'db-rollback-prod.yml'])('%s never cancels a run', (file) => {
    const wf = parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as {
      concurrency?: { 'cancel-in-progress'?: unknown };
    };
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
  });
});
