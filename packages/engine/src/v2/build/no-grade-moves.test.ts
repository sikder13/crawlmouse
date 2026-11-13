/**
 * CC-32 D2: rendering empty-root pages moves no grade within a check. Each build fixture named below
 * goes through the pipeline's order (sample → renderCandidates → renderCheck → buildCheck), and each
 * grade-guard case through renderCheck and gradeCheck, twice: with the empty-root phase's cap at 0 and
 * at EMPTY_ROOT_MAX_RENDERS. Each pair runs under caps with room for both phases and under a per-day
 * cap the graded phase's allowance fills exactly, where an empty-root render that took the graded
 * phase's room would leave a graded page unrendered. For a build fixture the whole `Check` record of the
 * two runs must be equal; for a grade case, the grades, content and signals.
 *
 * The recorded built site's render-outcome variants (fixtures/v2/build/rendered-states.ts) edit a
 * render outcome after the fact rather than run the render, so they are compared with the empty-root
 * picks added to their outcome as rendered shells, not through renderCheck.
 *
 * So that a pair cannot pass by rendering no empty-root page, each fixture states how many the second
 * run rendered, and the grade cases gain two empty-root pages of their own. This compares two runs of
 * this engine; that the engine before CC-32 gave the same grades rests on build/expected.json and
 * grade/expected.json, whose regenerations changed no grade (see the step's notes).
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHELL_REPLIES,
  emptyShellBuild,
} from '../../../fixtures/v2/build/empty-shell-site.js';
import {
  HOST,
  readRecorded,
  recordedBuild,
  recordedInput,
} from '../../../fixtures/v2/build/recorded.js';
import { SHELL_ROUTES, shellBuild, shellUrl } from '../../../fixtures/v2/build/shell-site.js';
import { recordedWith } from '../../../fixtures/v2/build/rendered-states.js';
import { servedSite } from '../../../fixtures/v2/build/site/serve.js';
import { CLIENT_RENDERED } from '../../../fixtures/v2/build/site/site.js';
import { guardInputs } from '../../../fixtures/v2/grade/guard.js';
import { gradeCheck, type GradeInput } from '../grade/index.js';
import type { DailyBudget, RenderCaps } from '../render/budget.js';
import {
  EMPTY_ROOT_MAX_RENDERS,
  selectEmptyRoots,
  type EmptyRootCandidate,
} from '../render/empty-root.js';
import { fakeClient, memoryDailyBudget, type ReplyFixture } from '../render/fakes.js';
import { renderCheck, RESERVE_PER_RENDER_MS, type RenderOutcome } from '../render/run.js';
import { selectRenders, type RenderCandidate } from '../render/sample.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { buildCheck } from './build.js';
import { emptyRootPool, renderCandidates, sample } from './plan.js';
import type { BuildInput } from './types.js';

const PAGE = 2 * RESERVE_PER_RENDER_MS;
const LOOSE: RenderCaps = { perCheckMs: 600_000, perDayMs: 3_600_000 };

/** An app shell's two sides, for a route a fixture serves no HTML for. */
const shellReply = (url: string): ReplyFixture => ({
  provenance: 'no-grade-moves',
  url,
  static: { html: '<html><body><div id="root"></div></body></html>', browser_ms: 500 },
  rendered: {
    html: `<html><body><main><p>${'text '.repeat(50)}</p></main></body></html>`,
    browser_ms: 900,
  },
});

/** The built site's own HTML, as generate.ts replies with it; the guides' rendered side filled in. */
function builtSiteReplies(): ReplyFixture[] {
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

/** The caps a pair runs under: room for both phases, and a day the graded phase's allowance fills. */
const capsFor = (gradedPicks: number): Record<string, RenderCaps> => ({
  'room for both phases': LOOSE,
  'a per-day cap the graded phase fills': { perCheckMs: 600_000, perDayMs: gradedPicks * PAGE },
});

async function render(
  plan: {
    candidates: readonly RenderCandidate[];
    openFixTemplates: readonly string[];
    maxRenders: number;
    emptyRootCandidates: readonly EmptyRootCandidate[];
  },
  replies: readonly ReplyFixture[],
  caps: RenderCaps,
  maxEmptyRootRenders: number,
  daily: DailyBudget = memoryDailyBudget(),
): Promise<RenderOutcome> {
  return renderCheck({
    ...plan,
    previousStates: new Map(),
    maxEmptyRootRenders,
    client: fakeClient(replies),
    admit: async () => {},
    caps,
    daily,
    sleep: async () => {},
  });
}

const emptyRootRendered = (o: RenderOutcome) =>
  o.pages.filter((p) => p.picked_for === 'empty_root' && p.rendered).length;

interface BuildFixture {
  input: () => BuildInput;
  replies: readonly ReplyFixture[];
  /** How many empty-root pages the run with the phase on renders, with room for both phases. */
  emptyRoots: number;
}

const BUILD_FIXTURES: Record<string, BuildFixture> = {
  'the recorded built site': {
    input: recordedBuild,
    replies: builtSiteReplies(),
    emptyRoots: 2,
  },
  'the built site with a link to the redirect target': {
    input: () => ({ ...recordedInput(), batches: readRecorded('variant'), render: null }),
    replies: builtSiteReplies(),
    emptyRoots: 2,
  },
  ...Object.fromEntries(
    ([true, false] as const).flatMap((clientRendered) =>
      (['SHELL', 'SHELL_WITH_TEXT'] as const).map((shell) => [
        `the shell site, ${shell}, client_rendered ${clientRendered}`,
        {
          input: () => shellBuild({ clientRendered, shell }),
          replies: SHELL_ROUTES.map((p) => shellReply(shellUrl(p))),
          // SHELL leaves every route but the homepage thin; SHELL_WITH_TEXT keeps them content
          emptyRoots: clientRendered && shell === 'SHELL' ? EMPTY_ROOT_MAX_RENDERS : 0,
        },
      ]),
    ),
  ),
  'the empty-shell site': {
    input: emptyShellBuild,
    replies: EMPTY_SHELL_REPLIES,
    emptyRoots: EMPTY_ROOT_MAX_RENDERS,
  },
};

async function buildWith(f: BuildFixture, caps: RenderCaps, maxEmptyRootRenders: number) {
  const input = f.input();
  const a = assemble(input, readBatches(input.batches, input.check, input.lineage.worker_release));
  const s = sample(a);
  const plan = renderCandidates(a, [...s.stage1, ...s.stage2], [], new Map());
  const outcome = await render(plan, f.replies, caps, maxEmptyRootRenders);
  return { plan, outcome, built: buildCheck({ ...input, render: outcome }) };
}

describe('no grade moves when empty-root pages are rendered: the build fixtures', () => {
  for (const [name, f] of Object.entries(BUILD_FIXTURES)) {
    it(`${name}`, async () => {
      const { plan } = await buildWith(f, LOOSE, 0);
      const picks = selectRenders(plan.candidates, plan.openFixTemplates, plan.maxRenders).length;
      for (const [capsName, caps] of Object.entries(capsFor(picks))) {
        const off = await buildWith(f, caps, 0);
        const on = await buildWith(f, caps, EMPTY_ROOT_MAX_RENDERS);
        expect(on.built.check, capsName).toEqual(off.built.check);
        expect(emptyRootRendered(off.outcome), capsName).toBe(0);
        if (caps === LOOSE) expect(emptyRootRendered(on.outcome), capsName).toBe(f.emptyRoots);
      }
    });
  }
});

/** A grade case with two empty-root pages added: thin, answering 200 with HTML, read as app shells. */
function withShells(input: GradeInput): GradeInput {
  const base = input.pages[0]!;
  const shells: PageResult[] = ['a', 'b'].map((slug) => ({
    ...base,
    url: `${new URL(base.url).origin}/shell/${slug}`,
    template_key: '/shell/{slug}',
    kind: 'thin',
    status_code: 200,
    is_html: true,
    is_orphan: false,
    without_js: null,
  }));
  const content = new Map(input.content);
  for (const p of shells)
    content.set(p.url, { ...[...input.content.values()][0]!, client_rendered: true });
  return { ...input, pages: [...input.pages, ...shells], content };
}

async function gradeWith(input: GradeInput, caps: RenderCaps, maxEmptyRootRenders: number) {
  const candidates = input.pages.map(
    (p): EmptyRootCandidate => ({
      url: p.url,
      template_key: p.template_key,
      kind: p.kind,
      status_code: p.status_code,
      is_html: p.is_html,
      pagerank_share: p.pagerank_share,
      fetched_under_our_robots: true,
      client_rendered: input.content.get(p.url)?.client_rendered === true,
    }),
  );
  const plan = {
    candidates,
    openFixTemplates: [],
    maxRenders: 25,
    emptyRootCandidates: candidates,
  };
  const outcome = await render(
    plan,
    input.pages.map((p) => shellReply(p.url)),
    caps,
    maxEmptyRootRenders,
  );
  const measured = new Map(
    outcome.pages.flatMap((p) => (p.rendered ? [[p.url, p.without_js] as const] : [])),
  );
  const pages = input.pages.map((p) => ({ ...p, without_js: measured.get(p.url) ?? p.without_js }));
  const g = gradeCheck({ ...input, pages });
  return {
    plan,
    outcome,
    numbers: {
      technical_seo: g.technical_seo,
      ai_readability: g.ai_readability,
      content: g.content,
      signals: g.signals,
    },
  };
}

describe('no grade moves when empty-root pages are rendered: the grade cases', () => {
  for (const [name, { input }] of Object.entries(guardInputs())) {
    it(`${name}`, async () => {
      const shelled = withShells(input);
      const { plan } = await gradeWith(shelled, LOOSE, 0);
      const picks = selectRenders(plan.candidates, plan.openFixTemplates, plan.maxRenders).length;
      for (const [capsName, caps] of Object.entries(capsFor(picks))) {
        const off = await gradeWith(shelled, caps, 0);
        const on = await gradeWith(shelled, caps, EMPTY_ROOT_MAX_RENDERS);
        expect(on.numbers, capsName).toEqual(off.numbers);
        if (caps === LOOSE) expect(emptyRootRendered(on.outcome), capsName).toBe(2);
      }
    });
  }
});

describe('no grade moves when empty-root pages are rendered: the rendered-states variants', () => {
  for (const edit of ['shell', 'one_shell', 'not_rendered'] as const) {
    it(`the recorded built site, ${edit}`, () => {
      const input = recordedWith(edit);
      const a = assemble(
        input,
        readBatches(input.batches, input.check, input.lineage.worker_release),
      );
      const picks = selectEmptyRoots(emptyRootPool(a), EMPTY_ROOT_MAX_RENDERS);
      expect(picks.length).toBeGreaterThan(0);
      const render = input.render!;
      const withShells = {
        ...render,
        pages: [
          ...render.pages,
          ...picks.map((p) => ({
            ...p,
            rendered: true as const,
            without_js: {
              raw_words: 0,
              rendered_words: 300,
              text_share: 0,
              state: 'empty_shell' as const,
            },
          })),
        ],
      };
      const off = buildCheck(input);
      const on = buildCheck({ ...input, render: withShells });
      expect(on.check).toEqual(off.check);
    });
  }
});
