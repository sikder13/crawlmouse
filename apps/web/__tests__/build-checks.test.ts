import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skipBuildChecks } from '../lib/build-checks.mjs';

// `next build`'s own type check and lint are skipped on Vercel and nowhere else (owner ruling,
// 2026-11-13): Vercel's build machine ran out of memory in that step, and both are required
// checks in CI, whose `build` job runs `next build` with them on.

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (config: unknown) => config }));

interface BuildConfig {
  typescript: { ignoreBuildErrors: boolean };
  eslint: { ignoreDuringBuilds: boolean };
}
async function configWith(vercel: string | undefined): Promise<BuildConfig> {
  vi.resetModules();
  if (vercel === undefined) vi.stubEnv('VERCEL', '');
  else vi.stubEnv('VERCEL', vercel);
  if (vercel === undefined) delete process.env.VERCEL;
  return ((await import('../next.config.mjs')) as { default: BuildConfig }).default;
}

afterEach(() => vi.unstubAllEnvs());

describe('next build’s own type check and lint', () => {
  it('are skipped for VERCEL=1 and for no other value', () => {
    expect(skipBuildChecks({ VERCEL: '1' })).toBe(true);
    for (const VERCEL of [undefined, '', '0', 'true', 'TRUE', ' 1', '1 ']) {
      expect(skipBuildChecks({ VERCEL })).toBe(false);
    }
  });

  it('the config skips both on Vercel, and runs both anywhere else', async () => {
    const onVercel = await configWith('1');
    expect([onVercel.typescript.ignoreBuildErrors, onVercel.eslint.ignoreDuringBuilds]).toEqual([
      true,
      true,
    ]);
    for (const elsewhere of [undefined, '0']) {
      const config = await configWith(elsewhere);
      expect([config.typescript.ignoreBuildErrors, config.eslint.ignoreDuringBuilds]).toEqual([
        false,
        false,
      ]);
    }
  });

  it('turbo hands VERCEL to the build, which strict mode would otherwise leave out', () => {
    const turbo = JSON.parse(read('turbo.json')) as { tasks: { build: { env: string[] } } };
    expect(turbo.tasks.build.env).toContain('VERCEL');
  });

  it('CI’s build job runs next build without VERCEL, so both checks run there', () => {
    const ci = read('.github/workflows/ci.yml');
    // The job `build`, up to the next job at the same indent.
    const job = /\n  build:\n([\s\S]*?)\n  [a-z][a-z0-9-]*:\n/.exec(ci)![1]!;
    expect(job).toContain('pnpm build');
    expect(job).not.toMatch(/\bVERCEL\b/);
    // Nor do the workflow's own env, the setup action, or the file the job reads its env from.
    expect(ci.slice(0, ci.indexOf('\njobs:'))).not.toMatch(/\bVERCEL\b/);
    expect(read('.github/actions/setup/action.yml')).not.toMatch(/\bVERCEL\b/);
    expect(read('apps/web/.env.ci')).not.toMatch(/^\s*VERCEL=/m);
  });
});
