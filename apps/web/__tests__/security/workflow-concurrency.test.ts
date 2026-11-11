import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Every workflow has a concurrency group (docs/specs/v2/ci-cost.md, D4). A newer run of the same
// ref cancels an older one, except where cancelling midway would leave something half done, and
// never on main: there each run has a group of its own.

const WORKFLOWS = join(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..'),
  '.github/workflows',
);

const ON_MAIN_ITS_OWN =
  "${{ github.ref == 'refs/heads/main' && format('-{0}', github.run_id) || '' }}";

const EXPECTED: Record<string, { group: string; cancel: boolean; why: string }> = {
  'ci.yml': {
    group: `ci-\${{ github.ref }}${ON_MAIN_ITS_OWN}`,
    cancel: true,
    why: 'a newer push makes the older run of the branch moot; a pull request event has its own ref',
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
      concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
    };
    const want = EXPECTED[file]!;
    expect(wf.concurrency, want.why).toEqual({
      group: want.group,
      'cancel-in-progress': want.cancel,
    });
  });

  it('never cancels a production database run', () => {
    for (const file of ['db-apply-prod.yml', 'db-rollback-prod.yml']) {
      expect(EXPECTED[file]!.cancel).toBe(false);
    }
  });
});
