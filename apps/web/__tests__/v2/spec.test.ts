import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SPEC_PATH, buildSpec } from './spec/build-spec';
import { SPEC_22_PATH, buildSpec22 } from './spec/build-spec-22';

describe('docs/specs/v2/21-design-system.md', () => {
  it('is exactly what the generator writes from the code', async () => {
    expect(existsSync(SPEC_PATH), 'run __tests__/v2/generate-spec.ts').toBe(true);
    const committed = readFileSync(SPEC_PATH, 'utf8');
    expect(committed).toBe(await buildSpec());
  }, 60_000);

  it('lists the nine primitives the step asked for, read from the exports', async () => {
    const spec = await buildSpec();
    for (const name of [
      'Button',
      'StatusPill',
      'Grade',
      'VerdictCell',
      'CoverageLine',
      'Card',
      'Table',
      'Field',
      'PageShell',
    ]) {
      expect(spec, name).toContain(`### ${name}\n`);
    }
  }, 60_000);
});

describe('docs/specs/v2/22-audit-flow.md', () => {
  it('is exactly what the generator writes from the code', async () => {
    expect(existsSync(SPEC_22_PATH), 'run __tests__/v2/generate-spec.ts').toBe(true);
    expect(readFileSync(SPEC_22_PATH, 'utf8')).toBe(await buildSpec22());
  }, 60_000);
});
