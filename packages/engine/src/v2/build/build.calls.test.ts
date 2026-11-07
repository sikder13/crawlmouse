/**
 * buildCheck calls each engine entry point once per check, and hands them one population: the same
 * pages and links are detected, graded and diffed. effectsOf is reached through detectorOutcomes,
 * which imports it from grade/effects.js, so it is wrapped at that module, where an ESM namespace
 * spy could not see the call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';

const wrap = <M extends Record<string, unknown>>(m: M, name: keyof M) => ({
  ...m,
  [name]: vi.fn(m[name] as (...a: unknown[]) => unknown),
});
vi.mock('../access/index.js', async (o) =>
  wrap(await o<Record<string, unknown>>(), 'detectAccess'),
);
vi.mock('../detectors/index.js', async (o) =>
  wrap(await o<Record<string, unknown>>(), 'detectStructure'),
);
vi.mock('../grade/index.js', async (o) => wrap(await o<Record<string, unknown>>(), 'gradeCheck'));
vi.mock('../grade/outcomes.js', async (o) =>
  wrap(await o<Record<string, unknown>>(), 'detectorOutcomes'),
);
vi.mock('../grade/effects.js', async (o) => wrap(await o<Record<string, unknown>>(), 'effectsOf'));
vi.mock('../diff/diff.js', async (o) => wrap(await o<Record<string, unknown>>(), 'diffCheck'));

const access = await import('../access/index.js');
const detectors = await import('../detectors/index.js');
const grade = await import('../grade/index.js');
const outcomes = await import('../grade/outcomes.js');
const effects = await import('../grade/effects.js');
const diff = await import('../diff/diff.js');
const { buildCheck } = await import('./build.js');
const { fileEdges, landingsOf } = await import('./filing.js');

const calls = () => ({
  detectAccess: vi.mocked(access.detectAccess).mock.calls,
  detectStructure: vi.mocked(detectors.detectStructure).mock.calls,
  gradeCheck: vi.mocked(grade.gradeCheck).mock.calls,
  detectorOutcomes: vi.mocked(outcomes.detectorOutcomes).mock.calls,
  effectsOf: vi.mocked(effects.effectsOf).mock.calls,
  diffCheck: vi.mocked(diff.diffCheck).mock.calls,
});

beforeEach(() => vi.clearAllMocks());

describe('buildCheck and the engine entry points', () => {
  it('calls each of the six once per check, in order', () => {
    buildCheck(recordedBuild());
    const c = calls();
    for (const [name, list] of Object.entries(c)) expect(list, name).toHaveLength(1);
    const order = Object.entries({
      detectAccess: access.detectAccess,
      detectStructure: detectors.detectStructure,
      gradeCheck: grade.gradeCheck,
      detectorOutcomes: outcomes.detectorOutcomes,
      effectsOf: effects.effectsOf,
      diffCheck: diff.diffCheck,
    }).map(([name, f]) => [name, vi.mocked(f).mock.invocationCallOrder[0]!] as const);
    expect([...order].sort((a, b) => a[1] - b[1]).map(([n]) => n)).toEqual(order.map(([n]) => n));
  });

  it('detects, grades and diffs one population of pages and links', () => {
    const out = buildCheck(recordedBuild());
    const c = calls();
    const urls = (pages: readonly { url: string }[]) => pages.map((p) => p.url);
    const structure = c.detectStructure[0]![0];
    const graded = c.gradeCheck[0]![0];
    expect(urls(c.detectAccess[0]![0].pages)).toEqual(urls(structure.pages));
    // The same pages, field by field, but for the two set from the structure detectors' records.
    const unorphaned = (ps: readonly object[]) =>
      ps.map((p) => ({ ...p, is_orphan: null, suggested_parent_url: null }));
    expect(unorphaned(graded.pages)).toEqual(unorphaned(structure.pages));
    // The same links: the detectors read them as recorded and file them; the grade reads them filed.
    expect(graded.edges).toEqual(fileEdges(structure.edges, landingsOf(structure.pages)));
    expect(c.detectorOutcomes[0]![0]).toBe(vi.mocked(grade.gradeCheck).mock.results[0]!.value);
    expect(c.effectsOf[0]![0]).toBe(vi.mocked(grade.gradeCheck).mock.results[0]!.value.inputs);
    expect(c.diffCheck[0]![0].current.check).toEqual(out.check);
    expect(urls(out.page_results)).toEqual(urls(graded.pages));
  });
});
