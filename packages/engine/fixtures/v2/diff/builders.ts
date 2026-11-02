/**
 * Records for the diff's tests, each a valid instance of the v2 contract (every builder parses what
 * it returns). Check `n` finishes on 2 October 2026 plus `n` days, so later checks are later.
 */
import {
  CheckSchema,
  FixEventSchema,
  FixSchema,
  FixTypeSchema,
  type Check,
  type Fix,
  type FixEvent,
  type FixStatus,
  type FixType,
} from '@crawlmouse/types/v2';
import { FIX_SECTION } from '../../../src/v2/diff/subjects.js';
import type { CheckSide, FixDraft } from '../../../src/v2/diff/types.js';

export const SITE = '50000000-0000-4000-8000-0000000000d1';
const hex = (n: number, width = 12) => n.toString(16).padStart(width, '0');
export const checkId = (n: number) => `c0000000-0000-4000-8000-${hex(n)}`;
export const fixId = (n: number) => `f0000000-0000-4000-8000-${hex(n)}`;
export const fingerprint = (n: number) => hex(n, 16);
export const finishedAt = (n: number) =>
  new Date(Date.UTC(2026, 9, 2 + n, 6, 0, 0)).toISOString().replace('.000Z', 'Z');

export const SCORED = ['GPTBot', 'PerplexityBot'] as const;

/** A finished check `n`, changed by `edit` before it is validated. */
export function check(n: number, edit: (c: Check) => void = () => {}): Check {
  const at = finishedAt(n);
  const c: Check = {
    id: checkId(n),
    site_id: SITE,
    previous_check_id: n > 1 ? checkId(n - 1) : null,
    status: 'finished',
    trigger: 'scheduled',
    grade_version: '2.0.0',
    queued_at: at,
    started_at: at,
    finished_at: at,
    tested_at: at,
    expires_at: null,
    deferred_until: null,
    failure_reason: null,
    result_email: null,
    coverage: {
      pages_discovered: 120,
      pages_crawled: 100,
      pages_sampled: 20,
      templates: [{ template_key: '/', label: 'Homepage', pages: 1 }],
      sample_strategy: { method: 'stratified_by_template', max_pages: 20 },
      gradeable: 90,
      excluded: [],
      excluded_by_robots: 0,
    },
    technical_seo: {
      score: 79,
      grade: 'B',
      breakdown: {
        orphanRatioScore: 0.9,
        depthScore: 0.7,
        anchorDiversityScore: 0.5,
        structureScore: 0.6,
      },
      refusal: { refused: false, triggers: [], confidenceCapped: false, unevaluable: [] },
      site_structure_score: 70,
    },
    ai_readability: {
      withheld: false,
      total: 40,
      grade: 'D',
      components: {
        access: { score: 20, max: 40, heuristic: false },
        readable: { score: 10, max: 30, heuristic: false },
        quotable: { score: 5, max: 20, heuristic: true },
        signals: { score: 5, max: 10, heuristic: false },
      },
      access_range: null,
    },
    structure: null,
    without_js: null,
    content: null,
    signals: [],
    crawlers: SCORED.map((ua) => ({
      ua,
      group: 'ai_search' as const,
      scored: true,
      verdict: 'allowed' as const,
      evidence_class: 'declared' as const,
      status: null,
      pages_measured: 20,
      cause: null,
      text_share: 0.8,
      confidence: 'confirmed' as const,
      by_template: [],
    })),
    stack: {
      frontend: {
        name: 'Next.js',
        framework: 'nextjs',
        version: '14',
        router: 'app',
        detected_from: 'asset paths',
      },
      backend: null,
      edge: { vendor: 'Cloudflare', detected_from: 'cf-ray header' },
    },
    competitors: [],
    progress: null,
  };
  edit(c);
  return CheckSchema.parse(c);
}

export const ALL_DETECTORS: readonly FixType[] = FixTypeSchema.options;

export function side(
  n: number,
  edit?: (c: Check) => void,
  extra: Partial<CheckSide> = {},
): CheckSide {
  return {
    check: check(n, edit),
    page_cap: 500,
    robots_txt: 'User-agent: *\nDisallow: /cart\n',
    detectors: ALL_DETECTORS,
    indeterminate: [],
    ...extra,
  };
}

/** What a detector reports for a fix of `type` it found; `rank` and `affected_pages` vary by call. */
export function draft(type: FixType, edit: Partial<FixDraft> = {}): FixDraft {
  return {
    type,
    section: FIX_SECTION[type],
    title: `Fix the ${type.replaceAll('_', ' ')}`,
    detail: null,
    recommendation_class: 'confirmed_defect',
    confidence: 'confirmed',
    affected_pages: 12,
    template_key: '/blog/{slug}',
    crawler_uas: type === 'robots_txt_blocks_crawler' ? ['GPTBot'] : [],
    effect: { technical_seo: 2, ai_readability: 6, ai_readability_pending_on: [], estimate: true },
    effort: { kind: 'minutes', minutes: 10 },
    before_after: [],
    packet: null,
    rank: 1,
    ...edit,
  };
}

/** The events that bring a fix to `status`, oldest first; `at` is the given check's finish. */
const HISTORY: Record<FixStatus, FixEvent['kind'][]> = {
  open: [],
  marked_done: ['marked_done'],
  verified_resolved: ['verified'],
  unable_to_verify: ['marked_done', 'unable_to_verify'],
  reopened: ['verified', 'reopened'],
};

const LAST_STATE: Record<FixStatus, Fix['last_state']> = {
  open: 'detected',
  marked_done: 'detected',
  verified_resolved: 'not_detected',
  unable_to_verify: 'indeterminate',
  reopened: 'detected',
};

/**
 * Fix `n` of `type`, at `status`, last measured on check `measuredOn` (first seen on check 1), with
 * the events that brought it there, all dated on that check.
 */
export function fixWithHistory(
  n: number,
  status: FixStatus,
  { type = 'orphan_pages', measuredOn = 1 }: { type?: FixType; measuredOn?: number } = {},
): { fix: Fix; events: FixEvent[] } {
  const d = draft(type);
  const { rank, ...rest } = d;
  const fix = FixSchema.parse({
    ...rest,
    id: fixId(n),
    site_id: SITE,
    fingerprint: fingerprint(n),
    number: n,
    status,
    last_state: LAST_STATE[status],
    last_measured_check_id: checkId(measuredOn),
    first_seen_check_id: checkId(1),
    rank: status === 'verified_resolved' ? null : rank,
    gone: null,
  });
  const events = HISTORY[status].map((kind, k) =>
    FixEventSchema.parse(
      kind === 'marked_done'
        ? { id: eventId(n, k), fix_id: fix.id, at: finishedAt(measuredOn), kind, by_seat_id: null }
        : {
            id: eventId(n, k),
            fix_id: fix.id,
            at: finishedAt(measuredOn),
            kind,
            check_id: checkId(measuredOn),
          },
    ),
  );
  return { fix, events };
}

const eventId = (fix: number, k: number) => `e0000000-0000-4000-8000-${hex(fix * 16 + k)}`;
