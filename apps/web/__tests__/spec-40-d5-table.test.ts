import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V2_EDITS, v2EditsMarkdown } from '../lib/blog/v2-edits';

// The spec's D5 table is the data's, rendered (OPERATING-RULES §10).
const spec = readFileSync(resolve(__dirname, '../../../docs/specs/v2/40-seo-launch.md'), 'utf8');

describe('docs/specs/v2/40-seo-launch.md D5 table', () => {
  it('is v2EditsMarkdown() between its markers, and lists each edit', () => {
    const table = spec.split('<!-- d5-table:start -->\n')[1]!.split('\n<!-- d5-table:end -->')[0];
    expect(table).toBe(v2EditsMarkdown());
    expect(V2_EDITS.length).toBeGreaterThan(0);
  });
});
