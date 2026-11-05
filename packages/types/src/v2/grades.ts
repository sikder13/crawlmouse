/**
 * The two grades every check carries.
 *
 * TechnicalSeo reuses the v1 grade shape: `score`, `grade`, `breakdown` and `refusal` keep their v1
 * names and keys (camelCase inside `breakdown` and `refusal`), pinned to the v1 types by
 * v1-pins.test.ts. The contract carries no weights: how the score is computed is the engine's.
 *
 * AiReadability is new: four components with fixed maxima (Access 40 / Readable 30 / Quotable 20 /
 * Signals 10) and a total. It is withheld when a component could not be measured (FACTS I4 for Access):
 * the grade then names why in `withheld_reasons`, and each component without a score carries the
 * range its score could take. `access_range` repeats the Access component's range for the screens that
 * read it. `scored_from_fewer_crawlers` says when Access was scored from fewer than two crawlers
 * because the rest are disallowed by robots.txt. The engine scores letters on v1's scale; the
 * contract does not pin AI letters to scores.
 */
import { z } from 'zod';
import { ScoreSchema, ShareSchema } from './common.js';
import { GradeLetterSchema, RefusalTriggerSchema, WithheldReasonSchema } from './enums.js';
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

/** The scores a component could take, within its maximum. */
function rangeOf(max: number) {
  return z.strictObject({ min: z.number().min(0).max(max), max: z.number().min(0).max(max) });
}

/** A component of a given grade: scored, with no range. */
function component<Max extends number, H extends boolean>(max: Max, heuristic: H) {
  return z.strictObject({
    score: z.number().min(0).max(max),
    max: z.literal(max),
    heuristic: z.literal(heuristic),
    range: z.null(),
  });
}

/** A component of a withheld grade: scored, or unscored with the range it could take. */
function maybeScored<Max extends number, H extends boolean>(max: Max, heuristic: H) {
  return z
    .strictObject({
      score: z.number().min(0).max(max).nullable(),
      max: z.literal(max),
      heuristic: z.literal(heuristic),
      range: rangeOf(max).nullable(),
    })
    .check(
      rules((c, rule) => {
        rule.exactlyWhen('component_range', c.score === null, c.range !== null);
        if (c.range && c.range.min > c.range.max) rule.fail('range_order');
      }),
    );
}

const reasons = z.array(WithheldReasonSchema);

/**
 * How many scored crawlers Access was scored from, when that is fewer than two (FACTS I4): every
 * other scored crawler is disallowed by robots.txt, the site's stated choice. Null otherwise.
 */
const fewer = z.int().min(1).nullable();

const measured = z.strictObject({
  withheld: z.literal(false),
  withheld_reasons: reasons,
  total: ScoreSchema,
  grade: GradeLetterSchema,
  components: z.strictObject({
    access: component(40, false),
    readable: component(30, false),
    quotable: component(20, true),
    signals: component(10, false),
  }),
  access_range: z.null(),
  scored_from_fewer_crawlers: fewer,
});

const withheld = z
  .strictObject({
    withheld: z.literal(true),
    withheld_reasons: reasons,
    total: z.null(),
    grade: z.null(),
    components: z.strictObject({
      access: maybeScored(40, false),
      readable: maybeScored(30, false),
      quotable: maybeScored(20, true),
      signals: maybeScored(10, false),
    }),
    access_range: rangeOf(40).nullable(),
    scored_from_fewer_crawlers: fewer,
  })
  .check(
    rules((g, rule) => {
      const c = g.components;
      const parts = [c?.access, c?.readable, c?.quotable, c?.signals];
      if (parts.every((p) => p && p.score !== null)) rule.fail('withheld_unmeasured');
      const range = c?.access?.range ?? null;
      const same =
        range === null || g.access_range === null
          ? range === g.access_range
          : range.min === g.access_range.min && range.max === g.access_range.max;
      if (!same) rule.fail('access_range_mirror');
      const named: readonly string[] = g.withheld_reasons ?? [];
      const expected: string[] = [
        c?.readable?.score === null ? 'readable_unmeasured' : null,
        c?.quotable?.score === null ? 'quotable_unmeasured' : null,
        c?.signals?.score === null ? 'signals_unmeasured' : null,
      ].filter((r): r is string => r !== null);
      const access: readonly string[] = named.filter(
        (r) => r === 'too_few_crawlers_measured' || r === 'blocked_by_choice',
      );
      const others = named.filter((r) => !access.includes(r));
      const matches =
        new Set(named).size === named.length &&
        access.length === (c?.access?.score === null ? 1 : 0) &&
        others.length === expected.length &&
        expected.every((r) => others.includes(r));
      const unscored = parts.some((p) => p && p.score === null);
      if (named.length > 0 && unscored && !matches) rule.fail('withheld_reasons_match');
    }),
  );

export const AiReadabilitySchema = z.discriminatedUnion('withheld', [measured, withheld]).check(
  rules((g, rule) => {
    rule.exactlyWhen('withheld_reasons', g.withheld, (g.withheld_reasons ?? []).length > 0);
    const fewerThan = g.scored_from_fewer_crawlers ?? null;
    if (fewerThan !== null && (fewerThan >= 2 || g.components?.access?.score === null)) {
      rule.fail('fewer_crawlers');
    }
    if (g.withheld) return;
    const c = g.components;
    const sum = c.access.score + c.readable.score + c.quotable.score + c.signals.score;
    if (Math.abs(g.total - sum) > 0.01) rule.fail('total_sum');
  }),
);

export type GradeBreakdownV2 = z.infer<typeof GradeBreakdownSchema>;
export type TechnicalSeo = z.infer<typeof TechnicalSeoSchema>;
export type AiReadability = z.infer<typeof AiReadabilitySchema>;
