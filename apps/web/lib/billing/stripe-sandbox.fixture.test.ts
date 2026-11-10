import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sandboxKey } from './stripe-sandbox.fixture';

const NAME = 'STRIPE_ACCOUNT_TEST_SECRET_KEY';

function envFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc03-key-'));
  const path = join(dir, '.env.local');
  writeFileSync(path, text);
  return path;
}

describe('sandboxKey', () => {
  it('takes a test key from the environment first', () => {
    expect(sandboxKey({ [NAME]: ' sk_test_env ' }, envFile(`${NAME}=sk_test_file\n`))).toBe(
      'sk_test_env',
    );
  });

  it('reads the env file’s own line when the environment has none', () => {
    const path = envFile(`OTHER=x\n${NAME}=sk_test_file\nMORE=y\n`);
    expect(sandboxKey({}, path)).toBe('sk_test_file');
  });

  it('is null with no key anywhere, so the smoke is skipped', () => {
    expect(sandboxKey({}, envFile('OTHER=x\n'))).toBeNull();
    expect(sandboxKey({}, join(tmpdir(), 'cc03-no-such-dir', '.env.local'))).toBeNull();
  });

  it.each(['sk_live_abc', 'rk_live_abc', 'rk_test_abc', 'pk_test_abc'])(
    'refuses %s, and does not repeat it in the error',
    (key) => {
      expect(() => sandboxKey({ [NAME]: key }, '')).toThrow(`${NAME} is not a test key`);
      try {
        sandboxKey({ [NAME]: key }, '');
      } catch (e) {
        expect((e as Error).message).not.toContain(key);
      }
    },
  );
});
