/**
 * buildCheck on the recorded built-site fixture (fixtures/v2/build): the golden output byte for byte,
 * what it refuses, and each planted defect, asserted from the site's own constants rather than from
 * expected.json, so the golden file cannot vouch for itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AccessTestSchema,
  ChangeSchema,
  CheckSchema,
  crawlerRegistryVersion,
  FixEventSchema,
  FixSchema,
  LinkEdgeSchema,
  MeasurementLineageSchema,
  PageResultSchema,
  type AccessBatchResult,
  type BatchResult,
  type CrawlBatchResult,
} from '@crawlmouse/types/v2';
import {
  CANONICAL_PAGE,
  CANONICAL_TARGET,
  CLIENT_RENDERED,
  DEEP,
  EDGE_REFUSED,
  HREFLANG_ALT,
  HREFLANG_PAGE,
  ORPHAN,
  PAGINATION_SECOND,
  REDIRECT_FROM,
  REDIRECT_TO,
  ROBOTS_BLOCKED,
  THIN,
} from '../../../fixtures/v2/build/site/site.js';
import {
  HOST,
  readRecorded,
  recordedBuild,
  recordedInput,
} from '../../../fixtures/v2/build/recorded.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { buildCheck, serialiseBuilt } from './build.js';
import { registryVersion } from './lineage.js';
import { SUMMARY_BYTES } from './summaries.js';
import type { BuildInput } from './types.js';

const EXPECTED = new URL('../../../fixtures/v2/build/expected.json', import.meta.url);
const at = (path: string) => (path === '/' ? HOST : `${HOST}${path}`);
const built = buildCheck(recordedBuild());
const page = (path: string) => built.page_results.find((p) => p.url === at(path))!;
const fixesOf = (type: string) => built.fixes.filter((f) => f.type === type);
const structure = (type: string, path: string) =>
  built.grades.inputs.seo.detections.find((d) => d.type === type && d.key.endsWith(`:${at(path)}`));

describe('buildCheck on the recorded site', () => {
  it('gives exactly expected.json', () => {
    expect(serialiseBuilt(built)).toBe(readFileSync(EXPECTED, 'utf8'));
  });

  it('gives the same bytes twice', () => {
    expect(serialiseBuilt(buildCheck(recordedBuild()))).toBe(
      serialiseBuilt(buildCheck(recordedBuild())),
    );
  });

  it('gives the same bytes whatever order the batches arrive in, and with a retried batch twice', () => {
    const input = recordedBuild();
    const shuffled = { ...input, batches: [...input.batches].reverse().concat(input.batches[0]!) };
    expect(serialiseBuilt(buildCheck(shuffled))).toBe(serialiseBuilt(built));
  });

  it('returns rows every contract schema accepts', () => {
    const golden = JSON.parse(readFileSync(EXPECTED, 'utf8')) as typeof built;
    expect(CheckSchema.safeParse(golden.check).success).toBe(true);
    for (const [schema, rows] of [
      [PageResultSchema, golden.page_results],
      [LinkEdgeSchema, golden.link_edges],
      [AccessTestSchema, golden.access_tests],
      [FixSchema, golden.fixes],
      [FixEventSchema, golden.fix_events],
      [ChangeSchema, golden.changes],
    ] as const) {
      for (const r of rows) expect(schema.safeParse(r).success).toBe(true);
    }
    // A site's first check writes fixes and changes; fix events come from later checks (below).
    expect(
      [
        golden.page_results,
        golden.link_edges,
        golden.access_tests,
        golden.fixes,
        golden.changes,
      ].every((r) => r.length > 0),
    ).toBe(true);
    expect(golden.fix_events).toEqual([]);
    expect(MeasurementLineageSchema.safeParse(golden.lineage).success).toBe(true);
    expect(golden.usage_event).toBeNull();
  });

  it(`keeps each phase summary under ${SUMMARY_BYTES} bytes`, () => {
    expect(built.summaries.map((s) => s.phase)).toEqual([
      'robots_and_sitemap',
      'homepage',
      'crawl',
      'crawler_tests',
      'without_js',
      'grading',
    ]);
    for (const s of built.summaries)
      expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThan(SUMMARY_BYTES);
  });
});

describe('the planted defects', () => {
  it('an orphan: in the sitemap, linked from nowhere, with a parent from v1', () => {
    expect(built.link_edges.some((e) => e.to_url === at(ORPHAN))).toBe(false);
    expect(page(ORPHAN)).toMatchObject({
      is_orphan: true,
      found_via: 'sitemap',
      depth: null,
      links_in: 0,
    });
    const parent = page(ORPHAN).suggested_parent_url!;
    expect(built.page_results.some((p) => p.url === parent && p.kind === 'content')).toBe(true);
    expect(fixesOf('orphan_pages').map((f) => f.affected_pages)).toEqual([1]);
  });

  it('a page four clicks deep: its depth is its place on the only path to it', () => {
    // site.ts CHAIN: the homepage links the first post, and each links the next; DEEP is the fourth.
    expect(page(DEEP).depth).toBe(4);
    expect(structure('deep_pages', DEEP)?.state).toBe('detected');
  });

  it('a redirect chain of two hops, on the URL that redirects', () => {
    expect(page(REDIRECT_FROM).redirect!.hops).toHaveLength(2);
    expect(page(REDIRECT_FROM).final_url).toBe(at(REDIRECT_TO));
    expect(structure('redirect_chain', REDIRECT_FROM)?.state).toBe('detected');
    expect(fixesOf('redirect_chain')).toHaveLength(1);
  });

  it('a canonical to a page that answers 404', () => {
    expect(page(CANONICAL_TARGET).status_code).toBe(404);
    const d = structure('canonical_mismatch', CANONICAL_PAGE)!;
    expect(d.state).toBe('detected');
    expect(built.grades.inputs.seo.detections).toContainEqual(
      expect.objectContaining({ key: d.key }),
    );
    expect(fixesOf('canonical_mismatch')).toHaveLength(1);
  });

  it('an hreflang alternate that does not annotate back', () => {
    expect(page(HREFLANG_PAGE).hreflang!.links.map((l) => l.hreflang)).toContain('fr');
    expect(page(HREFLANG_ALT).hreflang!.links.map((l) => l.hreflang)).toEqual(['fr']);
    expect(structure('hreflang_gap', HREFLANG_PAGE)?.state).toBe('detected');
    expect(fixesOf('hreflang_gap')).toHaveLength(1);
  });

  it('a second page of a list that repeats the first', () => {
    expect(page(PAGINATION_SECOND).kind).toBe('pagination');
    expect(fixesOf('duplicate_pagination').map((f) => f.template_key)).toEqual([
      '/collections/{slug}',
    ]);
  });

  it('a crawler robots.txt blocks: detected as the site chose it, so it opens no fix', () => {
    expect(built.check.crawlers.find((c) => c.ua === ROBOTS_BLOCKED)).toMatchObject({
      verdict: 'disallowed_by_robots',
      cause: 'robots_txt_disallow',
    });
    expect(fixesOf('robots_txt_blocks_crawler')).toEqual([]);
  });

  it('a crawler the edge refuses while others are served: a fix naming it', () => {
    expect(built.check.crawlers.find((c) => c.ua === EDGE_REFUSED)!.verdict).toBe(
      'blocked_by_ua_rule',
    );
    expect(fixesOf('edge_rule_blocks_crawler').map((f) => f.crawler_uas)).toEqual([[EDGE_REFUSED]]);
  });

  it('a thin page, left out of the graded population and counted as excluded', () => {
    expect(page(THIN).kind).toBe('thin');
    expect(built.check.coverage!.excluded).toContainEqual(
      expect.objectContaining({ kind: 'thin' }),
    );
  });

  it('a client-rendered template: read as an app shell, and (found by this fixture) classified thin, so never rendered', () => {
    const rows = readRecorded('batches').flatMap((b) => (b.kind === 'crawl' ? b.pages : []));
    for (const path of CLIENT_RENDERED) {
      expect(rows.find((r) => r.url === at(path))!.content_features!.client_rendered).toBe(true);
      expect(page(path).kind).toBe('thin');
      expect(page(path).without_js).toBeNull();
    }
  });

  it('stage 2 of the sample, because a scored crawler is refused on the blog only', () => {
    const access = readRecorded('batches').filter((b) => b.kind === 'access');
    expect(access).toHaveLength(2);
    expect(built.check.coverage!.pages_sampled).toBeGreaterThan(25);
  });
});

/** The recorded input with one change. */
const edited = (edit: (i: BuildInput) => void): BuildInput => {
  const input = structuredClone(recordedBuild());
  edit(input);
  return input;
};
const crawlOf = (i: BuildInput) =>
  i.batches.filter((b) => (b as BatchResult).kind === 'crawl') as CrawlBatchResult[];
const accessOf = (i: BuildInput) =>
  i.batches.filter((b) => (b as BatchResult).kind === 'access') as AccessBatchResult[];

describe('what buildCheck refuses', () => {
  it('a check graded with another grade version', () => {
    expect(() => buildCheck(edited((i) => (i.check.grade_version = '1.9.0')))).toThrow(
      /grades 2\.0\.0/,
    );
  });

  it("another check's batch", () => {
    expect(() =>
      buildCheck(edited((i) => (i.check.id = 'b0000000-0000-4000-8000-0000000000c9'))),
    ).toThrow(/belongs to check/);
  });

  it('one batch id with two different results', () => {
    expect(() =>
      buildCheck(
        edited((i) => {
          const twin = structuredClone(crawlOf(i)[0]!);
          twin.requests += 1;
          i.batches = [...i.batches, twin];
        }),
      ),
    ).toThrow(/arrived twice with different results/);
  });

  it('a URL crawled in two batches', () => {
    expect(() =>
      buildCheck(
        edited((i) => {
          const [a, b] = crawlOf(i);
          b!.pages.push(structuredClone(a!.pages[0]!));
        }),
      ),
    ).toThrow(/crawled in two batches/);
  });

  it('batches from a worker build the lineage does not name', () => {
    expect(() => buildCheck(edited((i) => (i.lineage.worker_release = 'abcdef012345')))).toThrow(
      /one lineage names one release/,
    );
  });

  it('an access test of a page the sample does not hold', () => {
    const unsampled = built.page_results.find((p) => !p.sampled && p.status_code === 200)!;
    expect(() =>
      buildCheck(
        edited((i) => {
          const row = structuredClone(accessOf(i)[0]!.access_tests[0]!);
          accessOf(i)[0]!.access_tests.push({
            ...row,
            id: 'e0000000-0000-4000-8000-999999999999',
            page_url: unsampled.url,
            template_key: unsampled.template_key,
          });
        }),
      ),
    ).toThrow(/the sample does not hold/);
  });

  it('a render of a page the sample does not hold', () => {
    const unsampled = built.page_results.find((p) => !p.sampled)!;
    expect(() => buildCheck(edited((i) => (i.render!.pages[0]!.url = unsampled.url)))).toThrow(
      /a render of .* the sample does not hold/,
    );
  });

  it('a row the contract refuses, naming the collection, the row and the field', () => {
    expect(() => buildCheck(edited((i) => (i.check.expires_at = 'tomorrow')))).toThrow(
      /check\[0\] is not a valid row: expires_at/,
    );
  });
});

describe('lineage and usage', () => {
  it("names the registry the access detectors read, by CC-06b's own hash", async () => {
    expect(built.lineage.crawler_registry_version).toBe(
      await crawlerRegistryVersion(CRAWLER_REGISTRY_V2),
    );
    expect(registryVersion(CRAWLER_REGISTRY_V2)).toBe(built.lineage.crawler_registry_version);
    expect(built.lineage).toMatchObject({
      detector_ruleset_version: '2.0.0',
      population_version: null,
    });
  });

  it('meters a check a site keeps: delivered, billable, every request the batches made', () => {
    const account = 'b0000000-0000-4000-8000-0000000000e1';
    const kept = buildCheck(edited((i) => (i.site.account_id = account)));
    const requests = recordedBuild().batches.reduce(
      (n: number, b) => n + (b as BatchResult).requests,
      0,
    );
    expect(kept.usage_event).toMatchObject({
      account_id: account,
      kind: 'check_finished',
      check_id: recordedInput().check.id,
      result: 'delivered',
      billable: true,
      request_count: requests,
      occurred_at: recordedInput().check.finished_at,
    });
  });
});

describe('the next check of the site', () => {
  it('reads this check back through diff_inputs: a fix marked done and still detected reopens', () => {
    const orphan = built.fixes.find((f) => f.type === 'orphan_pages')!;
    const marked = {
      id: 'b0000000-0000-4000-8000-0000000000f1',
      fix_id: orphan.id,
      at: '2026-11-06T09:00:00Z',
      kind: 'marked_done' as const,
      by_seat_id: null,
    };
    const next = buildCheck(
      edited((i) => {
        i.check.id = 'b0000000-0000-4000-8000-0000000000c2';
        i.check.previous_check_id = built.check.id;
        i.check.trigger = 'fix_recheck';
        i.check.queued_at = '2026-11-06T10:00:00Z';
        i.check.started_at = '2026-11-06T10:00:02Z';
        i.check.finished_at = '2026-11-06T10:11:00Z';
        i.previous = { check: built.check, ...built.diff_inputs };
        i.fixes = built.fixes.map((f) =>
          f.id === orphan.id ? { ...f, status: 'marked_done' } : f,
        );
        i.events = [marked];
        // The same recorded rows, renamed to the second check.
        i.batches = JSON.parse(JSON.stringify(i.batches).replaceAll(built.check.id, i.check.id));
        i.render = JSON.parse(JSON.stringify(i.render));
      }),
    );
    expect(next.fix_events).toEqual([
      expect.objectContaining({ fix_id: orphan.id, kind: 'reopened', check_id: next.check.id }),
    ]);
    expect(next.fixes.find((f) => f.id === orphan.id)!.status).toBe('reopened');
  });
});

describe('the redirect conflict (found by the built fixture)', () => {
  it('with a link to the final URL of a redirect, the crawl requests it, and the orphan can no longer be proved', () => {
    // variant/: the same site with one more link, to REDIRECT_TO, so the crawl requests it as a page.
    // detectors/scope.ts then leaves the redirect's links filed under REDIRECT_TO, so the redirecting
    // row's links_out exceeds the links filed under it, and absences become unprovable. CC-17's
    // effects.ts assumes the opposite filing. Reported, not settled here.
    const variant = buildCheck({
      ...recordedInput(),
      batches: readRecorded('variant'),
      render: null,
    });
    const golden = buildCheck({
      ...recordedInput(),
      batches: readRecorded('batches').filter((b) => b.kind === 'crawl'),
      render: null,
    });
    const orphan = (b: typeof built) =>
      b.grades.inputs.seo.detections.find(
        (d) => d.type === 'orphan_pages' && d.key.endsWith(ORPHAN),
      )!;
    expect(orphan(golden)).toMatchObject({ state: 'detected' });
    expect(orphan(variant)).toMatchObject({
      state: 'indeterminate',
      reason: 'links_not_fully_recorded',
    });
  });
});
