/**
 * The two grades every check carries.
 *
 * TechnicalSeo reuses the v1 grade shape: `score`, `grade`, `breakdown` and `refusal` keep their v1
 * names and keys (camelCase inside `breakdown` and `refusal`), pinned to the v1 types by
 * v1-pins.test.ts. The contract carries no weights: how the score is computed is the engine's.
 *
 * AiReadability is new: four components with fixed maxima (Access 40 / Readable 30 / Quotable 20 /
 * Signals 10) and a total. It is withheld, with Access shown as a range, when fewer than two scored
 * crawlers were measured (FACTS I4). Its letter scale is not defined anywhere yet, so the contract does
 * not pin AI letters to scores.
 */
import { z } from 'zod';
import { ScoreSchema, ShareSchema } from './common.js';
import { GradeLetterSchema, RefusalTriggerSchema } from './enums.js';
import { rules } from './rules.js';

export const GradeBreakdownSchema = z.strictObject({
  orphanRatioScore: ShareSchema,
  depthScore: ShareSchema,
  anchorDiversityScore: ShareSchema,
  structureScore: ShareSchema,
});

export const RefusalDecisionSchema = z.strictObject({
  refused: z.boolean(),
  triggers: z.array(RefusalTriggerSchema),
  confidenceCapped: z.boolean(),
  unevaluable: z.array(RefusalTriggerSchema),
});

export const TechnicalSeoSchema = z
  .strictObject({
    score: ScoreSchema.nullable(),
    grade: GradeLetterSchema.nullable(),
    breakdown: GradeBreakdownSchema,
    refusal: RefusalDecisionSchema,
    /** The site-structure sub-score (0..100) shown on its own on the Structure section. */
    site_structure_score: ScoreSchema.nullable(),
  })
  .check(
    rules((t, rule) => {
      rule.exactlyWhen('score_grade_pair', t.score === null, t.grade === null);
      rule.exactlyWhen('refusal_score', t.refusal?.refused === true, t.score === null);
    }),
  );

function component<Max extends number, H extends boolean>(max: Max, heuristic: H) {
  return z.strictObject({
    score: z.number().min(0).max(max),
    max: z.literal(max),
    heuristic: z.literal(heuristic),
  });
}

const readable = component(30, false);
const quotable = component(20, true);
const signals = component(10, false);

const measured = z.strictObject({
  withheld: z.literal(false),
  total: ScoreSchema,
  grade: GradeLetterSchema,
  components: z.strictObject({ access: component(40, false), readable, quotable, signals }),
  access_range: z.null(),
});

const withheld = z.strictObject({
  withheld: z.literal(true),
  total: z.null(),
  grade: z.null(),
  components: z.strictObject({
    access: z.strictObject({ score: z.null(), max: z.literal(40), heuristic: z.literal(false) }),
    readable,
    quotable,
    signals,
  }),
  access_range: z
    .strictObject({ min: z.number().min(0).max(40), max: z.number().min(0).max(40) })
    .check(
      rules((r, rule) => {
        if (r.min > r.max) rule.fail('access_range_order');
      }),
    ),
});

export const AiReadabilitySchema = z.discriminatedUnion('withheld', [measured, withheld]).check(
  rules((g, rule) => {
    if (g.withheld) return;
    const c = g.components;
    const sum = c.access.score + c.readable.score + c.quotable.score + c.signals.score;
    if (Math.abs(g.total - sum) > 0.01) rule.fail('total_sum');
  }),
);

export type GradeBreakdownV2 = z.infer<typeof GradeBreakdownSchema>;
export type TechnicalSeo = z.infer<typeof TechnicalSeoSchema>;
export type AiReadability = z.infer<typeof AiReadabilitySchema>;
