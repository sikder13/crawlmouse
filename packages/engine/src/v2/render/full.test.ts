/**
 * Row 17's full render on the recorded built site (60 pages, 54 the graded phase may render, 25 in the
 * sample): the plan, the merge with the sampled render, and the build's admission of it.
 */
import { describe, expect, it } from 'vitest';
import { HOST, recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { servedSite } from '../../../fixtures/v2/build/site/serve.js';
import { CLIENT_RENDERED } from '../../../fixtures/v2/build/site/site.js';
import { assemble } from '../build/assemble.js';
import { readBatches } from '../build/batches.js';
import { buildCheck } from '../build/build.js';
import { fullRenderCandidates, renderCandidates, sample } from '../build/plan.js';
import type { RenderCaps } from './budget.js';
import { fakeClient, memoryDailyBudget, type ReplyFixture } from './fakes.js';
import {
  FULL_RENDER_CHUNK_PAGES,
  FULL_RENDER_MAX_BROWSER_MS,
  fullRenderPlan,
  mergeFullRender,
} from './full.js';
import { renderCheck, type RenderOutcome } from './run.js';
import { renderable, type RenderCandidate } from './sample.js';

const LOOSE: RenderCaps = { perCheckMs: 600_000, perDayMs: 36_000_000 };

/** The built site's own HTML, as generate.ts replies with it; the guides' rendered side filled in. */
function replies(): ReplyFixture[] {
  const site = servedSite({ linkRedirectTarget: false });
  return [...site.pages.keys()].map((path) => {
    const html = site.pages.get(path)!.body;
    const rendered = (CLIENT_RENDERED as readonly string[]).includes(path)
      ? site.renderedGuide(path)
      : html;
    return {
      provenance: 'built-site',
      url: path === '/' ? HOST : `${HOST}${path}`,
      static: { html, browser_ms: 1200 },
      rendered: { html: rendered, browser_ms: 2400 },
    };
  });
}

const render = (candidates: readonly RenderCandidate[], maxRenders: number, caps = LOOSE) =>
  renderCheck({
    candidates,
    openFixTemplates: [],
    maxRenders,
    previousStates: new Map(),
    maxEmptyRootRenders: 0,
    client: fakeClient(replies()),
    admit: async () => {},
    caps,
    daily: memoryDailyBudget(),
    sleep: async () => {},
  });

async function recorded() {
  const input = recordedBuild();
  const a = assemble(input, readBatches(input.batches, input.check, input.lineage.worker_release));
  const s = sample(a);
  const sampledPlan = renderCandidates(a, [...s.stage1, ...s.stage2], [], new Map());
  const sampled = await render(sampledPlan.candidates, sampledPlan.maxRenders);
  const candidates = fullRenderCandidates(a);
  return { input, sampled, candidates, plan: fullRenderPlan(candidates, sampled) };
}

async function fullOf(r: Awaited<ReturnType<typeof recorded>>): Promise<RenderOutcome[]> {
  const chunks: RenderOutcome[] = [];
  const byUrl = new Map(r.candidates.map((c) => [c.url, c]));
  for (let i = 0; i < r.plan.length; i += FULL_RENDER_CHUNK_PAGES) {
    const chunk = r.plan.slice(i, i + FULL_RENDER_CHUNK_PAGES).map((p) => byUrl.get(p.url)!);
    chunks.push(await render(chunk, chunk.length));
  }
  return chunks;
}

describe('a full render (row 17)', () => {
  it('holds its budget as one named figure: 13,600 browser-seconds, $0.34 at $0.09 an hour', () => {
    expect(FULL_RENDER_MAX_BROWSER_MS).toBe(13_600_000);
    expect(Math.round((FULL_RENDER_MAX_BROWSER_MS / 3_600_000) * 0.09 * 100) / 100).toBe(0.34);
  });

  it('plans every renderable page the sample did not hold, and nothing else', async () => {
    const r = await recorded();
    const renderableUrls = new Set(r.candidates.filter(renderable).map((c) => c.url));
    const sampledUrls = new Set(r.sampled.pages.map((p) => p.url));
    expect(r.plan.length).toBe(29);
    for (const p of r.plan) {
      expect(renderableUrls.has(p.url), p.url).toBe(true);
      expect(sampledUrls.has(p.url), p.url).toBe(false);
    }
    expect(new Set([...r.plan.map((p) => p.url), ...sampledUrls])).toEqual(
      new Set([...renderableUrls, ...sampledUrls]),
    );
  });

  it('merges the chunks with the sample: every renderable page measured, the browser time summed, marked full', async () => {
    const r = await recorded();
    const chunks = await fullOf(r);
    const merged = mergeFullRender(r.sampled, chunks, r.plan, r.candidates, 'check_cap');
    expect(merged.full).toBe(true);
    // Every renderable page is in the outcome once; each is rendered unless the sample left it out
    // for its own reason, which stands.
    const renderableUrls = r.candidates.filter(renderable).map((c) => c.url);
    const urls = merged.pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of renderableUrls) expect(urls, u).toContain(u);
    // One page renders nothing (its reply has no body to measure): the page's own reason, not a cap.
    expect(
      merged.pages.filter((p) => !p.rendered).map((p) => [p.url, (p as { reason: string }).reason]),
    ).toEqual([[`${HOST}/products/old-dome-tent`, 'nothing_rendered']]);
    expect(merged.pages.filter((p) => p.rendered).length).toBe(53);
    expect(merged.browser_ms).toBe(
      r.sampled.browser_ms + chunks.reduce((n, c) => n + c.browser_ms, 0),
    );
    expect(merged.estimate.measured_pages).toBeGreaterThan(r.sampled.estimate.measured_pages);
  });

  it('names each planned page no chunk reached, not rendered, with the reason given', async () => {
    const r = await recorded();
    const merged = mergeFullRender(r.sampled, [], r.plan, r.candidates, 'out_of_time');
    const unreached = merged.pages.filter((p) => !p.rendered && p.reason === 'out_of_time');
    expect(unreached.map((p) => p.url)).toEqual(r.plan.map((p) => p.url));
  });

  it('is admitted by the build when marked full, and refused when not', async () => {
    const r = await recorded();
    const merged = mergeFullRender(r.sampled, await fullOf(r), r.plan, r.candidates, 'check_cap');
    expect(() => buildCheck({ ...r.input, render: merged })).not.toThrow();
    const { full: _full, ...unmarked } = merged;
    void _full;
    expect(() => buildCheck({ ...r.input, render: unmarked })).toThrow(/neither the sample/);
  });
});
