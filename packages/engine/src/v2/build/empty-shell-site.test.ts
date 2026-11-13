/**
 * A site that is an empty shell on most routes (fixtures/v2/build/empty-shell-site.ts), through the
 * pipeline's own order: sample → renderCandidates → renderCheck → buildCheck. The records below are
 * written by hand from the fixture's description, not read back from a run.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHELL_HOST,
  EMPTY_SHELL_REPLIES,
  emptyShellBuild,
  emptyShellUrl as at,
} from '../../../fixtures/v2/build/empty-shell-site.js';
import { fingerprintOf } from '../detectors/fingerprint.js';
import { detectRendered, type RenderedDetection } from '../detectors/rendered.js';
import { EMPTY_ROOT_MAX_RENDERS } from '../render/empty-root.js';
import { fakeClient, memoryDailyBudget } from '../render/fakes.js';
import { renderCheck } from '../render/run.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { buildCheck } from './build.js';
import { emptyRootUrls, renderCandidates, sample } from './plan.js';

async function pipeline(maxEmptyRootRenders = EMPTY_ROOT_MAX_RENDERS) {
  const input = emptyShellBuild();
  const a = assemble(input, readBatches(input.batches, input.check, input.lineage.worker_release));
  const s = sample(a);
  const plan = renderCandidates(a, [...s.stage1, ...s.stage2], [], new Map());
  const render = await renderCheck({
    ...plan,
    maxEmptyRootRenders,
    client: fakeClient(EMPTY_SHELL_REPLIES),
    admit: async () => {},
    caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
    daily: memoryDailyBudget(),
    sleep: async () => {},
  });
  const built = buildCheck({ ...input, render });
  return { assembled: a, render, built };
}

const SHELL = { raw_words: 0, rendered_words: 40, text_share: 0 };

function record(
  template_key: string,
  state: RenderedDetection['state'],
  reason: RenderedDetection['reason'],
  present: string[],
  rendered: string[],
): RenderedDetection {
  const key = `shell:${template_key}`;
  const post = template_key === '/blog/{slug}';
  return {
    type: 'client_rendered_template',
    fingerprint: fingerprintOf(key),
    key,
    template_key,
    state,
    reason,
    measured: rendered.length === 0 ? null : post ? 1 : 0,
    extent: {
      pages: present.length,
      graded: template_key === '/' || post ? present.length : 0,
      rendered: rendered.length,
    },
    affected_urls: state === 'detected' ? present.map(at) : [],
    evidence: {
      pages: rendered.map((p) => ({
        url: at(p),
        ...(post ? { raw_words: 60, rendered_words: 60, text_share: 1 } : SHELL),
      })),
    },
  };
}

const EXPECTED: RenderedDetection[] = [
  record('/', 'detected', null, ['/'], ['/']),
  record('/about-us', 'detected', null, ['/about-us'], ['/about-us']),
  record(
    '/app/{slug}',
    'detected',
    null,
    ['/app/billing-plans', '/app/team-settings', '/app/user-profile'],
    ['/app/billing-plans', '/app/user-profile'],
  ),
  record('/blog/{slug}', 'not_detected', null, ['/blog/hello-world'], ['/blog/hello-world']),
  record(
    '/docs/{slug}',
    'detected',
    null,
    ['/docs/api-reference', '/docs/getting-started'],
    ['/docs/api-reference', '/docs/getting-started'],
  ),
  record('/pricing-plans', 'indeterminate', 'not_rendered', ['/pricing-plans'], []),
];

describe('an empty shell on most routes, sample → renderCandidates → renderCheck → buildCheck', () => {
  it('classes the homepage and the post as content and every other shell as an empty-root page', async () => {
    const { assembled, built } = await pipeline();
    const kinds = Object.fromEntries(built.page_results.map((p) => [p.url, p.kind]));
    expect(kinds[EMPTY_SHELL_HOST]).toBe('content');
    expect(kinds[at('/blog/hello-world')]).toBe('content');
    expect([...emptyRootUrls(assembled)].sort()).toEqual(
      [
        '/about-us',
        '/app/billing-plans',
        '/app/team-settings',
        '/app/user-profile',
        '/docs/api-reference',
        '/docs/getting-started',
        '/pricing-plans',
      ].map(at),
    );
  });

  it('renders the graded pages, then five empty-root pages: two a template, by template key then PageRank', async () => {
    const { render } = await pipeline();
    expect(
      render.pages.map((p) => [p.url.slice(EMPTY_SHELL_HOST.length) || '/', p.picked_for]),
    ).toEqual([
      ['/', 'template'],
      ['/blog/hello-world', 'template'],
      ['/about-us', 'empty_root'],
      ['/app/user-profile', 'empty_root'],
      ['/app/billing-plans', 'empty_root'],
      ['/docs/api-reference', 'empty_root'],
      ['/docs/getting-started', 'empty_root'],
    ]);
    expect(render.pages.every((p) => p.rendered)).toBe(true);
  });

  it('gives every present template a record: the shells detected, the post not, the unrendered one indeterminate', async () => {
    const { assembled, built } = await pipeline();
    expect(detectRendered(built.page_results, { emptyRoots: emptyRootUrls(assembled) })).toEqual(
      EXPECTED,
    );
  });

  it('opens a client-rendered fix for each detected template, over its present pages', async () => {
    const { built } = await pipeline();
    const fixes = built.fixes
      .filter((f) => f.type === 'client_rendered_template')
      .map((f) => [f.template_key, f.affected_pages])
      .sort();
    expect(fixes).toEqual([
      ['/', 1],
      ['/about-us', 1],
      ['/app/{slug}', 3],
      ['/docs/{slug}', 2],
    ]);
    expect(built.diff_inputs.indeterminate).toContain(fingerprintOf('shell:/pricing-plans'));
  });

  it('with the empty-root phase off, only the homepage’s template opens: the shells are present and not rendered', async () => {
    const { built } = await pipeline(0);
    expect(
      built.fixes.filter((f) => f.type === 'client_rendered_template').map((f) => f.template_key),
    ).toEqual(['/']);
    for (const t of ['/about-us', '/app/{slug}', '/docs/{slug}', '/pricing-plans']) {
      expect(built.diff_inputs.indeterminate).toContain(fingerprintOf(`shell:${t}`));
    }
  });
});
