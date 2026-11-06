/**
 * Rendering never writes to disk. Two checks: a full render step runs with every write function of
 * node:fs and node:fs/promises replaced by one that records the call, and the render module's source
 * imports nothing that can write (the test support reads fixtures; the spec writer writes the spec).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const { writes, recordingWrites } = vi.hoisted(() => {
  const writes: string[] = [];
  const WRITERS = [
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'createWriteStream',
    'mkdir',
    'mkdirSync',
    'mkdtemp',
    'mkdtempSync',
    'copyFile',
    'copyFileSync',
    'rename',
    'renameSync',
    'open',
    'openSync',
    'symlink',
    'symlinkSync',
    'truncate',
    'truncateSync',
    'rm',
    'rmSync',
    'unlink',
    'unlinkSync',
    'cp',
    'cpSync',
  ];
  function recordingWrites<T extends Record<string, unknown>>(real: T, module: string): T {
    const out: Record<string, unknown> = { ...real };
    for (const name of WRITERS) {
      if (typeof real[name] === 'function') {
        out[name] = () => {
          writes.push(`${module}.${name}`);
          throw new Error(`write attempted: ${module}.${name}`);
        };
      }
    }
    return out as T;
  }
  return { writes, recordingWrites };
});

vi.mock('node:fs', async (original) => {
  const real = await original<Record<string, unknown>>();
  return { ...recordingWrites(real, 'fs'), default: recordingWrites(real, 'fs') };
});
vi.mock('node:fs/promises', async (original) => {
  const real = await original<Record<string, unknown>>();
  return { ...recordingWrites(real, 'fs/promises'), default: recordingWrites(real, 'fs/promises') };
});

const { renderCheck } = await import('./run.js');
const { fakeClient, memoryDailyBudget, replyFixtures } = await import('./fakes.js');

describe('a render step', () => {
  it('writes nothing to disk', async () => {
    const fixtures = [...replyFixtures().values()];
    const out = await renderCheck({
      candidates: fixtures.map((f, i) => ({
        url: f.url,
        template_key: `/t${i}`,
        kind: 'content',
        status_code: 200,
        is_html: true,
        pagerank_share: 0.1,
        fetched_under_our_robots: true,
      })),
      openFixTemplates: [],
      maxRenders: 25,
      previousStates: new Map(),
      client: fakeClient(fixtures),
      admit: async () => {},
      caps: { perCheckMs: 600_000, perDayMs: 600_000 },
      daily: memoryDailyBudget(),
    });
    expect(out.pages.every((p) => p.rendered)).toBe(true);
    expect(writes).toEqual([]);
  });

  it('would be caught writing: the recording is live', async () => {
    const fs = await import('node:fs');
    expect(() => fs.writeFileSync('/nonexistent/x', 'x')).toThrow(/write attempted/);
    expect(writes).toEqual(['fs.writeFileSync']);
    writes.length = 0;
  });
});

describe('the render module’s source', () => {
  const DIR = new URL('./', import.meta.url);
  const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const importsOf = (f: string) =>
    [...readFileSync(new URL(f, DIR), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

  // fakes.ts is test support; write-spec.ts writes the spec document and is run by hand, never by a render.
  const NOT_RENDERING = ['fakes.ts', 'write-spec.ts'];

  it('imports no module that can write, outside the test support and the spec writer', () => {
    const writable = /^(?:node:)?(?:fs|fs\/promises|os|child_process|worker_threads|net|dgram)$/;
    const found = sources
      .filter((f) => !NOT_RENDERING.includes(f))
      .flatMap((f) =>
        importsOf(f)
          .filter((m) => writable.test(m))
          .map((m) => `${f}: ${m}`),
      );
    expect(sources.length).toBeGreaterThan(5);
    expect(found).toEqual([]);
  });

  it('lets the test support read fixtures and nothing more', () => {
    const src = readFileSync(new URL('fakes.ts', DIR), 'utf8');
    expect(src).toMatch(/import \{ readdirSync, readFileSync \} from 'node:fs';/);
  });
});
