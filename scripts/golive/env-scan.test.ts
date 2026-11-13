import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPTIONAL_ENV,
  PLATFORM_ENV,
  READ_BY_LIBRARIES,
  REQUIRED_ENV,
  SWITCH_FLAGS,
  TEST_ONLY_ENV,
  WORKER_FLY_ENV,
  appClassOf,
  requiredThrough,
} from './env-classes';
import {
  REPO_ROOT,
  dynamicReadsIn,
  isTestFile,
  isWorkerFile,
  readsIn,
  scan,
  scanDynamic,
  sourceFiles,
} from './env-scan';

const reads = scan();
const appReads = reads.filter((r) => !isWorkerFile(r.file));
const workerReads = reads.filter((r) => isWorkerFile(r.file));
const names = (rs: typeof reads) => new Set(rs.map((r) => r.name));

describe('the matcher, one fixture per spelling', () => {
  const spellings: Array<[string, string]> = [
    ['process.env.X', 'export const a = process.env.FIX_A;'],
    ["process.env['X']", "export const a = process.env['FIX_A'];"],
    ['process.env["X"]', 'export const a = process.env["FIX_A"];'],
    ['process.env?.X', 'export const a = process.env?.FIX_A;'],
    ['env.X', 'export const f = (env: E) => env.FIX_A;'],
    ['env?.X', 'export const f = (env?: E) => env?.FIX_A;'],
    ["env['X']", "export const f = (env: E) => env['FIX_A'];"],
    ['someEnv.X', 'export const f = (workerEnv: E) => workerEnv.FIX_A;'],
    ['destructured from process.env', 'const { FIX_A } = process.env;'],
    ['destructured and renamed', 'const { FIX_A: a = "d" } = process.env;'],
    [
      'destructured from env',
      'export const f = (env: E) => { const { FIX_A } = env; return FIX_A; };',
    ],
    ['a *_ENV name constant', "export const URL_ENV = 'FIX_A';"],
    ['a typed *_ENV constant', "export const URL_ENV: string = 'FIX_A';"],
    ['an ENV table', "export const ENV = { a: 'FIX_A' } as const;"],
    ['a *_ENV table', "const CAP_ENV = { a: 'FIX_A' };"],
    ['inside a template expression', 'export const s = `x${process.env.FIX_A}y`;'],
  ];
  it.each(spellings)('finds %s', (_label, source) => {
    expect(readsIn(source, 'fixture.ts').map((r) => r.name)).toEqual(['FIX_A']);
  });

  it('finds a read in a .mjs and a .tsx file', () => {
    expect(
      readsIn('export default process.env.FIX_A;', 'next.config.mjs').map((r) => r.name),
    ).toEqual(['FIX_A']);
    expect(
      readsIn('export const C = () => <a>{process.env.FIX_A}</a>;', 'c.tsx').map((r) => r.name),
    ).toEqual(['FIX_A']);
  });

  const notReads: Array<[string, string]> = [
    ['a line comment', '// process.env.FIX_B is read elsewhere\nexport const a = 1;'],
    ['a block comment', "/* env['FIX_B'] and const { FIX_B } = process.env */ export const a = 1;"],
    ['a doc comment', '/** reads `env.FIX_B` */\nexport const a = 1;'],
    ['a string', "export const s = 'process.env.FIX_B';"],
    ['a template literal', 'export const s = `env.FIX_B and process.env.FIX_B`;'],
    ['a bare name string', "export const s = 'FIX_B';"],
    ['a lower-case property', 'export const f = (env: E) => env.fixB;'],
    ['a property of another object', 'export const f = (cfg: E) => cfg.FIX_B;'],
    ['a constant not named *_ENV', "export const URL_NAME = 'FIX_B';"],
  ];
  it.each(notReads)('does not count %s', (_label, source) => {
    expect(readsIn(source, 'fixture.ts')).toEqual([]);
  });

  it('reports a computed env[...] read it cannot name, and not a name-constant one', () => {
    expect(dynamicReadsIn('export const f = (env: E, k: string) => env[k];', 'f.ts')).toHaveLength(
      1,
    );
    expect(
      dynamicReadsIn("const A_ENV = 'X'; export const f = (env: E) => env[A_ENV];", 'f.ts'),
    ).toEqual([]);
    expect(
      dynamicReadsIn("const ENV = { a: 'X' }; export const f = (env: E) => env[ENV.a];", 'f.ts'),
    ).toEqual([]);
  });

  it('gives the line of the read', () => {
    expect(readsIn('\n\nexport const a = process.env.FIX_A;', 'f.ts')[0]!.line).toBe(3);
  });
});

describe('the files scanned', () => {
  const files = sourceFiles();
  it('covers the app, the Inngest functions and every package source', () => {
    expect(files).toContain('apps/web/middleware.ts');
    expect(files).toContain('apps/web/next.config.mjs');
    expect(files).toContain('inngest/check.ts');
    expect(files).toContain('packages/worker/src/config.ts');
    expect(files).toContain('packages/engine/src/crawler.ts');
  });
  it('leaves out tests, fixtures and node_modules', () => {
    expect(files.filter(isTestFile)).toEqual([]);
    expect(files.some((f) => f.includes('node_modules') || f.includes('/.next/'))).toBe(false);
    expect(files).not.toContain('apps/web/middleware.test.ts');
    expect(isTestFile('apps/web/lib/billing/stripe-sandbox.fixture.ts')).toBe(true);
    expect(isTestFile('apps/web/__tests__/x.ts')).toBe(true);
    expect(isTestFile('apps/web/lib/billing/catalog.ts')).toBe(false);
  });
});

describe('every name the code reads has a class', () => {
  it('finds reads at all (a scan that found nothing would pass the rest)', () => {
    expect(appReads.length).toBeGreaterThan(50);
    expect(workerReads.length).toBeGreaterThan(3);
  });

  it('classes every name the app, Inngest and the engine read', () => {
    const unclassed = appReads.filter((r) => appClassOf(r.name) === null);
    expect(unclassed.map((r) => `${r.name} at ${r.file}:${r.line}`)).toEqual([]);
  });

  it("classes every name the worker reads as the worker's Fly environment", () => {
    const unclassed = workerReads.filter((r) => !Object.hasOwn(WORKER_FLY_ENV, r.name));
    expect(unclassed.map((r) => `${r.name} at ${r.file}:${r.line}`)).toEqual([]);
  });

  it('has no computed env[...] read whose name the scan cannot see', () => {
    expect(scanDynamic()).toEqual([]);
  });

  it('puts no name in two app classes', () => {
    const all = [
      ...[1, 2, 3, 4, 5].flatMap((s) => Object.keys(REQUIRED_ENV[s as 1])),
      ...Object.keys(OPTIONAL_ENV),
      ...Object.keys(SWITCH_FLAGS),
      ...Object.keys(PLATFORM_ENV),
      ...Object.keys(TEST_ONLY_ENV),
    ];
    expect(all.length).toBe(new Set(all).size);
  });

  it('names nothing the code does not read (no stale or misspelt entry)', () => {
    const app = names(appReads);
    const classed = [
      ...[1, 2, 3, 4, 5].flatMap((s) => Object.keys(REQUIRED_ENV[s as 1])),
      ...Object.keys(OPTIONAL_ENV),
      ...Object.keys(SWITCH_FLAGS),
      ...Object.keys(PLATFORM_ENV),
      ...Object.keys(TEST_ONLY_ENV),
    ];
    expect(classed.filter((n) => !app.has(n) && !Object.hasOwn(READ_BY_LIBRARIES, n))).toEqual([]);
    const worker = names(workerReads);
    expect(Object.keys(WORKER_FLY_ENV).filter((n) => !worker.has(n))).toEqual([]);
  });

  it('classes every build-time name turbo.json lists', () => {
    const turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')) as {
      tasks: { build: { env: string[] } };
    };
    // GLOBAL_AUDITS_PER_DAY is listed there but is a code constant (apps/web/lib/limits.ts), not read
    // from the environment; NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and INNGEST_ENV are read by nothing here.
    const notRead = new Set([
      'GLOBAL_AUDITS_PER_DAY',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'INNGEST_ENV',
    ]);
    const missing = turbo.tasks.build.env.filter((n) => !notRead.has(n) && appClassOf(n) === null);
    expect(missing).toEqual([]);
    for (const n of notRead) expect(names(appReads).has(n), n).toBe(false);
  });
});

describe('the required names, pinned', () => {
  it('needs the three worker variables at step 1', () => {
    for (const n of [
      'CRAWL_WORKER_URL',
      'WORKER_SIGNING_SECRET',
      'WORKER_JWT_PRIVATE_KEY_PKCS8_B64',
    ]) {
      expect(Object.hasOwn(REQUIRED_ENV[1], n), n).toBe(true);
    }
  });
  it('needs EMAIL_LINK_SECRET at step 4 and not before', () => {
    expect(Object.hasOwn(REQUIRED_ENV[4], 'EMAIL_LINK_SECRET')).toBe(true);
    expect(requiredThrough(3)).not.toContain('EMAIL_LINK_SECRET');
    expect(requiredThrough(4)).toContain('EMAIL_LINK_SECRET');
  });
  it("needs the v2 Stripe account's key and mode at step 5", () => {
    expect(Object.hasOwn(REQUIRED_ENV[5], 'STRIPE_ACCOUNT_SECRET_KEY')).toBe(true);
    expect(Object.hasOwn(REQUIRED_ENV[5], 'STRIPE_ACCOUNT_LIVEMODE')).toBe(true);
  });
  it('does not require a flag before its own step', () => {
    for (const flag of Object.keys(SWITCH_FLAGS)) expect(requiredThrough(5)).not.toContain(flag);
  });
});
