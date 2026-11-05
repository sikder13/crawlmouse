import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-strict.sh');

/** A workspace laid out from `files` (path to contents), each package with a package.json. */
function workspace(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'run-strict-'));
  for (const pkg of ['apps/web', 'packages/engine', 'packages/timing', 'inngest', 'scripts']) {
    mkdirSync(join(root, pkg), { recursive: true });
    writeFileSync(join(root, pkg, 'package.json'), JSON.stringify({ name: `@x/${pkg}` }));
  }
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const list = (root: string) =>
  spawnSync('bash', [SCRIPT, '--list'], { cwd: root, encoding: 'utf8' });

describe('run-strict.sh: which files the strict run measures', () => {
  it('finds a direct import in any workspace package, .test.ts or .test.tsx, either quote', () => {
    const root = workspace({
      'packages/engine/src/a.test.ts': "import { expectWithinBudget } from '@crawlmouse/timing';",
      'apps/web/__tests__/b.test.tsx': 'import { expectWithinBudget } from "@crawlmouse/timing";',
      'inngest/c.test.ts': "import { expectWithinRelative } from '@crawlmouse/timing';",
      'scripts/d.test.ts': "import { median } from '@crawlmouse/timing';",
    });
    const r = list(root);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n').sort()).toEqual([
      'apps/web/__tests__/b.test.tsx',
      'inngest/c.test.ts',
      'packages/engine/src/a.test.ts',
      'scripts/d.test.ts',
    ]);
  });

  it("leaves out the helper's own tests, files that do not import it, and node_modules", () => {
    const root = workspace({
      'packages/timing/src/budget.test.ts': "import { x } from '@crawlmouse/timing';",
      'packages/engine/src/plain.test.ts': "import { describe } from 'vitest';",
      'packages/engine/node_modules/dep/e.test.ts': "import { x } from '@crawlmouse/timing';",
      'packages/engine/src/only.test.ts': "import { x } from '@crawlmouse/timing';",
    });
    expect(list(root).stdout.trim()).toBe('packages/engine/src/only.test.ts');
  });

  it('fails when no file is found, so a strict run that measured nothing cannot pass', () => {
    const r = list(workspace({}));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no test file imports @crawlmouse/timing');
  });
});
