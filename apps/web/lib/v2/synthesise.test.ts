import { describe, expect, it } from 'vitest';
import { instant, type Check } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, fixture, templateOf } from './fixtures';
import { stateAt, toProgress, type CrawlState } from './progress';
import { RecordingSchema } from './recording';
import {
  CHECKS,
  LOCKED_CRAWL_MOMENT,
  recording,
  recordingSpec,
  type RecordingName,
} from './recordings';
import { synthesise } from './synthesise';

const FINISHED: { name: RecordingName; check: string }[] = [
  { name: 'bad-site', check: CHECKS.badFirstAudit },
  { name: 'clean-site', check: CHECKS.cleanFirstAudit },
  { name: 'challenged-site', check: CHECKS.challengedFirstAudit },
];

/** Click depth of each node, from the links the stream reported. */
function depths(s: CrawlState): Map<string, number | null> {
  const byUrl = new Map(s.nodes.map((n) => [n.url, n]));
  const out = new Map<string, number | null>();
  const depthOf = (url: string, seen = new Set<string>()): number | null => {
    if (out.has(url)) return out.get(url)!;
    const n = byUrl.get(url)!;
    if (new URL(url).pathname === '/') return 0;
    if (!n.from || seen.has(url)) return null;
    seen.add(url);
    const up = depthOf(n.from, seen);
    return up === null ? null : up + 1;
  };
  for (const n of s.nodes) out.set(n.url, depthOf(n.url));
  return out;
}

describe.each(FINISHED)('the $name recording', ({ name, check: checkId }) => {
  const spec = recordingSpec(name);
  const d = fixture(spec.fixture);
  const check: Check = findCheck(d, checkId);
  const rec = recording(name);
  const end = stateAt(rec.events, Infinity);
  const coverage = check.coverage!;
  const structure = check.structure!;

  it('is labelled synthesised and parses as a recording', () => {
    expect(rec.provenance).toBe('synthesised');
    expect(RecordingSchema.safeParse(rec).success).toBe(true);
  });

  it('is the same stream every time it is made', () => {
    expect(synthesise(spec, d)).toEqual(rec);
  });

  it('ends at the check’s wall time with its status', () => {
    expect(rec.until_ms).toBe(instant(check.finished_at!) - instant(check.started_at!));
    expect(end.elapsed_ms).toBe(rec.until_ms);
    expect(end.ended).toBe(check.status);
    expect(end.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('crawls the pages, estimate and distinct links the check reports', () => {
    expect(end.pages_crawled).toBe(coverage.pages_crawled);
    expect(end.pages_estimated).toBe(coverage.pages_discovered);
    expect(end.links_found).toBe(structure.internal_links);
    expect(end.nodes).toHaveLength(coverage.pages_crawled);
  });

  it('puts each template’s page count on the map', () => {
    const keys = coverage.templates.map((t) => t.template_key);
    for (const t of coverage.templates) {
      const n = end.nodes.filter((x) => templateOf(keys, x.url) === t.template_key).length;
      expect(n, t.template_key).toBe(t.pages);
    }
  });

  it('classifies the orphan and JavaScript-only pages the check counts', () => {
    expect(end.nodes.filter((n) => n.kind === 'orphan')).toHaveLength(structure.orphan_pages);
    expect(end.nodes.filter((n) => n.kind === 'js_only')).toHaveLength(structure.js_only_pages);
    for (const n of end.nodes.filter((x) => x.kind === 'orphan')) expect(n.from).toBeNull();
    for (const n of end.nodes.filter((x) => x.kind === 'js_only')) expect(n.via).toBe('javascript');
  });

  it('links every other page, with as many deeper than three clicks as the check counts', () => {
    const depth = depths(end);
    const linked = end.nodes.filter((n) => n.kind !== 'orphan');
    for (const n of linked) expect(depth.get(n.url), n.url).not.toBeNull();
    const deep = linked.filter((n) => (depth.get(n.url) ?? 0) > 3);
    expect(deep).toHaveLength(structure.pages_deeper_than_3);
  });

  it('replays the fixture’s own pages with their status and link count', () => {
    for (const p of d.page_results.filter((r) => r.check_id === check.id)) {
      const f = end.fetches.find((x) => x.url === p.url && x.purpose === 'crawl');
      expect(f, p.url).toMatchObject({ status: p.status_code, links: p.links_out });
    }
  });

  it('lands every crawler verdict the check holds, as the check holds it', () => {
    const want = Object.fromEntries(
      check.crawlers.map((c) => [
        c.ua,
        {
          group: c.group,
          scored: c.scored,
          verdict: c.verdict,
          evidence_class: c.evidence_class,
          status: c.status,
          pages_measured: c.pages_measured,
        },
      ]),
    );
    const got = Object.fromEntries(
      Object.entries(end.verdicts).map(([ua, v]) => [
        ua,
        {
          group: v.group,
          scored: v.scored,
          verdict: v.verdict,
          evidence_class: v.evidence_class,
          status: v.status,
          pages_measured: v.pages_measured,
        },
      ]),
    );
    expect(got).toEqual(want);
  });

  it('tests the sample as each crawler, once a page', () => {
    for (const c of check.crawlers.filter((x) => x.evidence_class !== 'declared')) {
      const urls = end.fetches.filter((f) => f.identity === c.ua).map((f) => f.url);
      expect(urls, c.ua).toHaveLength(coverage.pages_sampled);
      expect(new Set(urls).size).toBe(coverage.pages_sampled);
    }
  });

  it('finds the fixes the check knew about, each once', () => {
    expect(end.findings.map((f) => f.title).sort()).toEqual(
      fixesAsOf(d, check)
        .map((f) => f.title)
        .sort(),
    );
  });

  it('reveals the check’s grades at the end', () => {
    expect(end.grades).toEqual({
      technical_seo: check.technical_seo,
      ai_readability: check.ai_readability,
    });
  });
});

describe('the bad-site recording at the locked moment', () => {
  const at = stateAt(recording('bad-site').events, LOCKED_CRAWL_MOMENT.at_ms);

  it('shows what Final-Crawl shows: 0:47, 128 of about 214 pages, 412 links, step three', () => {
    expect(at.elapsed_ms).toBe(47_000);
    expect(at.pages_crawled).toBe(128);
    expect(at.pages_estimated).toBe(214);
    expect(at.links_found).toBe(412);
    expect(at.steps.map((s) => s.state)).toEqual(['done', 'done', 'now', 'next', 'next', 'next']);
  });

  it('has the five locked fetch lines last, in order', () => {
    expect(at.fetches.slice(-5).map(({ url, status, links }) => ({ url, status, links }))).toEqual(
      LOCKED_CRAWL_MOMENT.last_fetches,
    );
  });
});

describe('the clean-site re-run recording', () => {
  const rec = recording('clean-site-rerun');
  const check = findCheck(fixture('clean-site'), CHECKS.cleanRerun);

  it('stops at the fixture’s moment, the stream still open', () => {
    expect(rec.until_ms).toBe(check.progress!.elapsed_ms);
    expect(rec.events.some((e) => e.type === 'ended')).toBe(false);
  });

  it('projects onto exactly the Progress snapshot the fixture holds for that moment', () => {
    expect(toProgress(stateAt(rec.events, rec.until_ms))).toEqual(check.progress);
  });
});
