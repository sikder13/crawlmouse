/**
 * What the grade-change guard pins (src/v2/grade/expected.json): the files the grades are computed
 * from, by digest, and the grades and effects of the example sites.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { every } from '../access/builders.js';
import { detectorOutcomes } from '../../../src/v2/grade/outcomes.js';
import { gradeCheck, type GradeInput } from '../../../src/v2/grade/index.js';
import type { AccessDetection } from '../../../src/v2/access/types.js';
import { blogSite, csrSite } from './sites.js';

const SRC = new URL('../../../src/', import.meta.url);

/** v1 modules the v2 grades import: changing one changes a grade, so it needs expected.json too. */
const V1_MODULES = [
  'grade.ts',
  'grade-inputs.ts',
  'refusal.ts',
  'graph.ts',
  'constants.ts',
  'analysis/orphans.ts',
  'analysis/depth.ts',
  'analysis/anchor.ts',
  'analysis/pagerank.ts',
  'analysis/structure.ts',
  'analysis/js-detect.ts',
];

/** Every file the grades are computed from: the v2 grade and content modules and V1_MODULES. */
export function gradeSources(): string[] {
  const own = ['v2/grade/', 'v2/content/'].flatMap((dir) =>
    readdirSync(new URL(dir, SRC))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `${dir}${f}`),
  );
  return [...own, ...V1_MODULES].sort();
}

export function sourceDigest(): string {
  const h = createHash('sha256');
  for (const f of gradeSources()) h.update(`${f}\0${readFileSync(new URL(f, SRC), 'utf8')}\0`);
  return h.digest('hex');
}

function outcomeOf(input: GradeInput, access: AccessDetection[] = []) {
  const g = gradeCheck(input);
  const { outcomes, overview } = detectorOutcomes(g, access, input.structure);
  return {
    technical_seo: g.technical_seo,
    ai_readability: g.ai_readability,
    content: g.content,
    signals: g.signals.map((s) => ({ signal: s.signal, state: s.state })),
    fixes: outcomes
      .flatMap((o) => (o.state === 'detected' ? [{ fingerprint: o.fingerprint, ...o.fix }] : []))
      .sort((a, b) => a.rank - b.rank)
      .map((f) => ({ type: f.type, fingerprint: f.fingerprint, rank: f.rank, effect: f.effect })),
    overview,
  };
}

const blocked = every(2, 'blocked_by_ua_rule');

/** The example sites, by name, and what the engine makes of each. */
export function guardCases(): Record<string, ReturnType<typeof outcomeOf>> {
  const blog = blogSite(
    13,
    8,
    { PerplexityBot: blocked, 'ChatGPT-User': every(2, 'allowed_thin') },
    [{ path: '/old-1' }, { path: '/old-2' }],
  );
  const refused = every(2, 'refused_unverified');
  const oneMeasured = blogSite(6, 0, {
    'OAI-SearchBot': refused,
    'ChatGPT-User': refused,
    'Claude-SearchBot': refused,
    PerplexityBot: blocked,
  });
  return {
    'client-rendered, 31 % text, every crawler served': outcomeOf(csrSite(0.31)),
    'client-rendered, not yet rendered': outcomeOf(csrSite(null)),
    'blog: a crawler blocked, one served thin, 8 openings without an answer, 2 orphans': outcomeOf(
      blog.input,
      blog.access,
    ),
    'blog: one scored crawler measured': outcomeOf(oneMeasured.input, oneMeasured.access),
  };
}
