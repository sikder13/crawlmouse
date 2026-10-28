/**
 * Fix: one recommended change, its lifecycle state and its estimated effect.
 *
 * `status` follows the append-only FixEvent history (the contract test checks the fixtures agree with
 * it). `last_state` must fit `status`, and only a resolved fix has no `rank`; this schema enforces
 * both. `rank` is the engine's order of impact among the site's live fixes at the last measured check
 * (the Free plan shows ranks 1–3); `number` is the stable label a person reads ("fix 2").
 */
import { z } from 'zod';
import {
  CountSchema,
  FingerprintSchema,
  IdSchema,
  ScoreSchema,
  TemplateKeySchema,
} from './common.js';
import {
  ConfidenceSchema,
  DetectionStateSchema,
  EstimateBoundSchema,
  FixMeasureSchema,
  FixSectionSchema,
  FixStatusSchema,
  FixTypeSchema,
  PacketFrameworkSchema,
  RecommendationClassSchema,
} from './enums.js';
import { rules } from './rules.js';

/** Points per grade, always an estimate. Keys follow the FACTS Developers JSON `effect`. */
export const EffectSchema = z
  .strictObject({
    technical_seo: ScoreSchema,
    /** Null while the AI effect cannot be estimated yet; then `ai_readability_pending_on` says why. */
    ai_readability: ScoreSchema.nullable(),
    ai_readability_pending_on: z.array(FingerprintSchema),
    estimate: z.literal(true),
  })
  .check(
    rules((e, rule) => {
      const waiting = (e.ai_readability_pending_on ?? []).length > 0;
      rule.exactlyWhen('effect_pending', e.ai_readability === null, waiting);
    }),
  );

export const EffortSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('minutes'), minutes: z.int().min(1) }),
  z.strictObject({
    kind: z.literal('templates'),
    templates: z.int().min(1),
    deploys: z.int().min(1),
  }),
]);

export const BeforeAfterSchema = z.strictObject({
  measure: FixMeasureSchema,
  /** A word count, a crawler count or a text share, or a yes/no; never negative. */
  today: z.union([z.number().min(0), z.boolean()]),
  after: z.union([z.number().min(0), z.boolean()]),
  after_bound: EstimateBoundSchema,
  after_is_estimate: z.literal(true),
});

export const FixPacketSchema = z.strictObject({
  framework: PacketFrameworkSchema,
  /** The stacks the packet can be rewritten for (the fix page's switch). */
  frameworks: z.array(PacketFrameworkSchema).min(1),
  context: z.array(z.string().min(1)).min(1),
  change: z.array(z.string().min(1)).min(1),
  keep: z.array(z.string().min(1)),
  verify: z.strictObject({
    command: z.string().min(1),
    expect: z.string().min(1),
    /**
     * The crawler the check requests as: one that can get in once this fix has landed, so the check
     * can pass (DESIGN-LOCK §7.3). Null when the check does not request as a crawler (reading
     * robots.txt). Nothing here enforces that; the engine chooses it.
     */
    ua: z.string().min(1).nullable(),
  }),
});

/**
 * What the last measurement must have found, for each status. `marked_done` has no entry: the owner
 * says it is done and the re-check has not reported yet, so the last state can be anything.
 */
export const LAST_STATE_FOR_STATUS: Partial<Record<string, string>> = {
  open: 'detected',
  reopened: 'detected',
  verified_resolved: 'not_detected',
  unable_to_verify: 'indeterminate',
};

export const FixSchema = z
  .strictObject({
    id: IdSchema,
    site_id: IdSchema,
    fingerprint: FingerprintSchema,
    number: z.int().min(0),
    type: FixTypeSchema,
    section: FixSectionSchema,
    title: z.string().min(1),
    detail: z.string().min(1).nullable(),
    recommendation_class: RecommendationClassSchema,
    status: FixStatusSchema,
    last_state: DetectionStateSchema,
    last_measured_check_id: IdSchema,
    first_seen_check_id: IdSchema,
    confidence: ConfidenceSchema,
    affected_pages: CountSchema,
    template_key: TemplateKeySchema.nullable(),
    /** Crawlers the fix is about, by registry token. */
    crawler_uas: z.array(z.string().min(1)),
    rank: z.int().min(1).nullable(),
    effect: EffectSchema,
    effort: EffortSchema.nullable(),
    before_after: z.array(BeforeAfterSchema),
    /**
     * Null only when no packet was written for this fix. Which plan may open a packet is decided where
     * the fix is shown, never stored here (v1 keeps all cures and gates them in the web layer).
     */
    packet: FixPacketSchema.nullable(),
  })
  .check(
    rules((f, rule) => {
      const required = LAST_STATE_FOR_STATUS[f.status];
      if (required && f.last_state !== required) rule.fail('fix_last_state');
      rule.exactlyWhen('fix_rank', f.status === 'verified_resolved', f.rank === null);
      if (f.packet && !(f.packet.frameworks ?? []).includes(f.packet.framework)) {
        rule.fail('packet_framework');
      }
    }),
  );

export type Effect = z.infer<typeof EffectSchema>;
export type Fix = z.infer<typeof FixSchema>;
