import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listChecks } from './check';
import { DOC_PATH, renderDoc } from './docs';

describe('docs/ops/db-migrations.md', () => {
  const doc = readFileSync(DOC_PATH, 'utf8');

  it('lists the checks as the check files render them (run tsx scripts/db/docs.ts to update)', () => {
    expect(doc).toEqual(renderDoc(doc));
  });

  it('names every check file, and a removed one would change the rendering', () => {
    for (const c of listChecks()) expect(doc).toContain(`\`${c.file}\``);
    const fewer = renderDoc(doc, '- **`01-only.sql`**: one check.');
    expect(fewer).not.toEqual(doc);
  });
});
