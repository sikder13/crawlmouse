import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SPEC_PATH, buildSpec } from './spec/build-spec';
import { SPEC_22_PATH, buildSpec22 } from './spec/build-spec-22';
import { SPEC_23_PATH, buildSpec23 } from './spec/build-spec-23';
import { SPEC_24_PATH, buildSpec24 } from './spec/build-spec-24';
import { SPEC_25_PATH, buildSpec25 } from './spec/build-spec-25';
import { CLAIM_REFUSALS } from '../../lib/auth/claim';
import { TRIAL_OUTCOMES } from '../../lib/auth/first-login';
import { ACCOUNT_DOOR_CHANGES } from '../../lib/v2/copy/account-door';

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

describe('docs/specs/v2/23-segments.md', () => {
  it('is exactly what the generator writes from the code', async () => {
    expect(existsSync(SPEC_23_PATH), 'run __tests__/v2/generate-spec.ts').toBe(true);
    expect(readFileSync(SPEC_23_PATH, 'utf8')).toBe(await buildSpec23());
  }, 60_000);
});

describe('docs/specs/v2/24-fix-and-map.md', () => {
  it('is exactly what the generator writes from the code', async () => {
    expect(existsSync(SPEC_24_PATH), 'run __tests__/v2/generate-spec.ts').toBe(true);
    expect(readFileSync(SPEC_24_PATH, 'utf8')).toBe(await buildSpec24());
  }, 60_000);
});

describe('docs/specs/v2/25-account-door.md', () => {
  it('is exactly what the generator writes from the code', async () => {
    expect(existsSync(SPEC_25_PATH), 'run __tests__/v2/generate-spec.ts').toBe(true);
    expect(readFileSync(SPEC_25_PATH, 'utf8')).toBe(await buildSpec25());
  }, 60_000);

  it('lists every claim refusal, trial outcome and copy correction the code holds', async () => {
    const spec = await buildSpec25();
    for (const code of [...Object.keys(CLAIM_REFUSALS), ...Object.keys(TRIAL_OUTCOMES)]) {
      expect(spec).toContain(`\`${code}\``);
    }
    expect(spec.match(/^\| (signup|check-email|check-email-no-audit) /gm)).toHaveLength(
      ACCOUNT_DOOR_CHANGES.length,
    );
  }, 60_000);
});
