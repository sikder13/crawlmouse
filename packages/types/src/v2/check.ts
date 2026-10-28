/**
 * Check: one audit of one site at one moment, and everything the audit screens read from it.
 *
 * Counts that the engine computes once over the whole crawl (links, orphans, depth, hub share) are
 * stored here. Values a screen can compute from other fields (means, "−2 since Thu", "2 of 6") are not.
 */
import { z } from 'zod';
import {
  CountSchema,
  crawledText,
  HostSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  instant,
  ScoreSchema,
  ShareSchema,
  TemplateKeySchema,
  TimestampSchema,
} from './common.js';
import {
  AccessCauseSchema,
  CheckPhaseSchema,
  CheckStatusSchema,
  CheckTriggerSchema,
  CmsNameSchema,
  ConfidenceSchema,
  ContentCheckSchema,
  CrawlerGroupSchema,
  DetectionStateSchema,
  EvidenceClassSchema,
  GradeLetterSchema,
  PageKindSchema,
  SampleMethodSchema,
  SignalKindSchema,
  StepStateSchema,
  VerdictSchema,
} from './enums.js';
import { AiReadabilitySchema, TechnicalSeoSchema } from './grades.js';
import { rules } from './rules.js';

export const CoverageSchema = z
  .strictObject({
    pages_discovered: CountSchema,
    pages_crawled: CountSchema,
    /** Pages fetched as each AI crawler: at most `sample_strategy.max_pages`, chosen by the engine across the templates (FACTS I1). */
    pages_sampled: CountSchema,
    templates: z.array(
      z.strictObject({
        template_key: TemplateKeySchema,
        label: z.string().min(1),
        pages: CountSchema,
      }),
    ),
    sample_strategy: z.strictObject({ method: SampleMethodSchema, max_pages: z.int().min(1) }),
    /** v1 coverage accounting: the graded population, and what was excluded from it and why. */
    gradeable: CountSchema,
    excluded: z.array(z.strictObject({ kind: PageKindSchema, count: CountSchema })),
  })
  .check(
    rules((c, rule) => {
      const excluded = (c.excluded ?? []).reduce((sum, e) => sum + (e?.count ?? 0), 0);
      if (c.gradeable + excluded > c.pages_crawled) rule.fail('coverage_gradeable');
      if (c.pages_crawled > c.pages_discovered) rule.fail('coverage_crawled');
      if (c.pages_sampled > c.pages_crawled || c.pages_sampled > c.sample_strategy?.max_pages) {
        rule.fail('coverage_sampled');
      }
    }),
  );

/** One crawler's result for a check: the row of the crawler matrix. Keys follow the FACTS Developers JSON. */
export const CrawlerResultSchema = z
  .strictObject({
    /** The crawler's registry token, e.g. "GPTBot". */
    ua: z.string().min(1),
    group: CrawlerGroupSchema,
    /** Counts towards AI readability (FACTS I6: the ai_search group). */
    scored: z.boolean(),
    verdict: VerdictSchema,
    evidence_class: EvidenceClassSchema,
    /** The HTTP status that decided the verdict; null when it rests on robots.txt alone. */
    status: HttpStatusSchema.nullable(),
    pages_measured: CountSchema,
    cause: AccessCauseSchema.nullable(),
    /** Share of a browser-rendered page's words this crawler can read; null when it read nothing measurable. */
    text_share: ShareSchema.nullable(),
    confidence: ConfidenceSchema,
    by_template: z.array(
      z.strictObject({
        template_key: TemplateKeySchema,
        verdict: VerdictSchema,
        status: HttpStatusSchema.nullable(),
      }),
    ),
  })
  .check(
    rules((r, rule) => {
      rule.exactlyWhen('crawler_scored', r.scored, r.group === 'ai_search');
    }),
  );

/**
 * The verdicts that say nothing about what the crawler gets: we did not measure it, or the site's edge
 * blocked our own requests whoever we said we were. Every other verdict counts as measured (FACTS I4).
 */
export const UNMEASURED_VERDICTS: readonly string[] = ['not_measured', 'edge_blocks_automation'];

/** How many scored crawlers were measured; AI readability is withheld when this is below two. */
export function scoredCrawlersMeasured(
  crawlers: readonly { scored?: boolean; verdict?: string }[],
): number {
  return crawlers.filter(
    (r) =>
      r?.scored === true && r.verdict !== undefined && !UNMEASURED_VERDICTS.includes(r.verdict),
  ).length;
}

export const StructureSchema = z.strictObject({
  internal_links: CountSchema,
  orphan_pages: CountSchema,
  js_only_pages: CountSchema,
  pages_deeper_than_3: CountSchema,
  avg_click_depth: z.number().min(0),
  hubs: CountSchema,
  hub_pagerank_share: ShareSchema,
  generic_anchor_share: ShareSchema,
});

export const ContentSummarySchema = z.strictObject({
  /** "Content an answer engine can quote", 0..100. */
  score: ScoreSchema,
  checks: z.array(
    z.strictObject({
      check: ContentCheckSchema,
      /** Templates the check does not apply to are absent ("—" on the screen). */
      by_template: z.array(
        z.strictObject({
          template_key: TemplateKeySchema,
          passing: CountSchema,
          total: CountSchema,
        }),
      ),
    }),
  ),
});

export const SignalResultSchema = z.strictObject({
  signal: SignalKindSchema,
  state: DetectionStateSchema,
  /** Schema and Content Signals count, five points each (FACTS B5); the rest change nothing yet. */
  counts_toward_grade: z.boolean(),
  /** "Where we looked": what was requested and what came back; it can quote the site, so it is bounded. */
  evidence: crawledText(500, 1),
});

export const StackSchema = z.strictObject({
  frontend: z
    .strictObject({
      name: z.string().min(1),
      version: z.string().nullable(),
      router: z.string().nullable(),
      detected_from: z.string().min(1),
    })
    .nullable(),
  backend: z.strictObject({ cms: CmsNameSchema, detected_from: z.string().min(1) }).nullable(),
  edge: z.strictObject({ vendor: z.string().min(1), detected_from: z.string().min(1) }).nullable(),
});

const GradeSummarySchema = z.strictObject({ score: ScoreSchema, grade: GradeLetterSchema });

export const CompetitorSnapshotSchema = z.strictObject({
  host: HostSchema,
  crawlers_with_access: CountSchema,
  crawlers_tested: CountSchema,
  text_share: ShareSchema,
  product_schema: z.boolean(),
  technical_seo: GradeSummarySchema,
  /** Null when the competitor's AI readability was withheld. Plan gating is applied where it is shown. */
  ai_readability: GradeSummarySchema.nullable(),
  /** Null when the competitor's signals could not be read. */
  signals_present: CountSchema.nullable(),
});

export const ProgressSchema = z.strictObject({
  steps: z.array(z.strictObject({ phase: CheckPhaseSchema, state: StepStateSchema })).min(1),
  pages_crawled: CountSchema,
  pages_estimated: CountSchema.nullable(),
  links_found: CountSchema,
  elapsed_ms: CountSchema,
  recent_fetches: z.array(
    z.strictObject({ url: HttpUrlSchema, status: HttpStatusSchema, links: CountSchema }),
  ),
});

export const CheckSchema = z
  .strictObject({
    id: IdSchema,
    site_id: IdSchema,
    /** The check immediately before this one on the same site, whatever its status. */
    previous_check_id: IdSchema.nullable(),
    status: CheckStatusSchema,
    trigger: CheckTriggerSchema,
    grade_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    queued_at: TimestampSchema,
    started_at: TimestampSchema.nullable(),
    finished_at: TimestampSchema.nullable(),
    /** When the crawler tests ran ("Tested 25 Oct 2026 at 02:33 UTC"). */
    tested_at: TimestampSchema.nullable(),
    /** An audit nobody kept is visible until this instant; null once an account keeps it. */
    expires_at: TimestampSchema.nullable(),
    deferred_until: TimestampSchema.nullable(),
    failure_reason: z.string().min(1).nullable(),
    /**
     * "Email me the result" on the crawl page (FACTS J7): the emailed link opens the audit read-only
     * until `link_expires_at` (30 days), well past `expires_at`, and does not sign anyone in. The
     * recipient's address is deliberately not here: public reports and the API read Check, so it stays
     * with the email delivery.
     */
    result_email: z
      .strictObject({
        sent_at: TimestampSchema.nullable(),
        link_expires_at: TimestampSchema,
      })
      .nullable(),
    /** Set exactly when the crawl finished (finished or partial); a queued, running, failed or deferred check has none. */
    coverage: CoverageSchema.nullable(),
    technical_seo: TechnicalSeoSchema.nullable(),
    ai_readability: AiReadabilitySchema.nullable(),
    structure: StructureSchema.nullable(),
    without_js: z.strictObject({ site_text_share: ShareSchema }).nullable(),
    content: ContentSummarySchema.nullable(),
    signals: z.array(SignalResultSchema),
    crawlers: z.array(CrawlerResultSchema),
    stack: StackSchema.nullable(),
    competitors: z.array(CompetitorSnapshotSchema),
    progress: ProgressSchema.nullable(),
  })
  .check(
    rules((c, rule) => {
      const ended = c.status === 'finished' || c.status === 'partial' || c.status === 'failed';
      const graded = c.status === 'finished' || c.status === 'partial';
      rule.exactlyWhen('check_progress', c.status === 'running', c.progress !== null);
      if ((c.status === 'queued' || c.status === 'deferred') && c.started_at !== null) {
        rule.fail('check_not_started');
      }
      if ((c.status === 'running' || ended) && c.started_at === null) rule.fail('check_started');
      rule.exactlyWhen('check_finished_at', ended, c.finished_at !== null);
      rule.exactlyWhen('check_deferred_until', c.status === 'deferred', c.deferred_until !== null);
      rule.exactlyWhen('check_failure_reason', c.status === 'failed', c.failure_reason !== null);
      rule.exactlyWhen('check_coverage', graded, c.coverage !== null);
      if (c.status === 'finished' && (c.technical_seo === null || c.ai_readability === null)) {
        rule.fail('check_both_grades');
      }
      if (!graded && (c.technical_seo || c.ai_readability)) rule.fail('check_grades_when_ended');
      const sent = c.result_email?.sent_at;
      if (sent && instant(c.result_email!.link_expires_at) <= instant(sent)) {
        rule.fail('check_result_link');
      }
      if (c.ai_readability) {
        const withheld = scoredCrawlersMeasured(c.crawlers ?? []) < 2;
        if (withheld && !c.ai_readability.withheld) rule.fail('i4_withheld');
        if (!withheld && c.ai_readability.withheld) rule.fail('i4_given');
      }
    }),
  );

export type Coverage = z.infer<typeof CoverageSchema>;
export type CrawlerResult = z.infer<typeof CrawlerResultSchema>;
export type Check = z.infer<typeof CheckSchema>;
