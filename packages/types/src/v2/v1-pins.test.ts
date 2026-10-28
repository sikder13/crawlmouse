/**
 * Reuse, never duplicate: where v2 carries a shape that v1 already defines, the v2 schema is pinned to
 * the v1 type here. These assertions are checked by `tsc` (pnpm typecheck), so a change to either side
 * that breaks the equality fails the typecheck gate.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type {
  AuditResult,
  CmsName,
  CoverageAccounting,
  GradeBreakdown,
  PageKind,
  RefusalDecision,
  RefusalTrigger,
} from '../audit.js';
import type {
  CmsNameSchema,
  CoverageSchema,
  GradeBreakdownSchema,
  PageKindSchema,
  RefusalDecisionSchema,
  RefusalTriggerSchema,
  TechnicalSeo,
} from './index.js';
import { V1_PINNED_ENUMS } from './index.js';

describe('v2 shapes pinned to their v1 definitions', () => {
  it('the pinned group is exactly the four value sets pinned here and in the engine', () => {
    // PageKind, CmsName and RefusalTrigger are pinned below; GradeLetter is pinned to scoreToLetter in
    // packages/engine/src/v2/contract-pins.test.ts. A new entry must come with a new pin.
    expect(Object.keys(V1_PINNED_ENUMS).sort()).toEqual([
      'CmsName',
      'GradeLetter',
      'PageKind',
      'RefusalTrigger',
    ]);
  });

  it('GradeBreakdown is the v1 GradeBreakdown', () => {
    expectTypeOf<z.infer<typeof GradeBreakdownSchema>>().toEqualTypeOf<GradeBreakdown>();
  });
  it('RefusalDecision is the v1 RefusalDecision', () => {
    expectTypeOf<z.infer<typeof RefusalDecisionSchema>>().toEqualTypeOf<RefusalDecision>();
  });
  it('RefusalTrigger is the v1 RefusalTrigger', () => {
    expectTypeOf<z.infer<typeof RefusalTriggerSchema>>().toEqualTypeOf<RefusalTrigger>();
  });
  it('PageKind is the v1 PageKind', () => {
    expectTypeOf<z.infer<typeof PageKindSchema>>().toEqualTypeOf<PageKind>();
  });
  it('CmsName is the v1 CmsName', () => {
    expectTypeOf<z.infer<typeof CmsNameSchema>>().toEqualTypeOf<CmsName>();
  });
  it('TechnicalSeo carries the v1 grade fields and stays assignable to them', () => {
    type V1Grade = Pick<AuditResult, 'score' | 'grade' | 'breakdown'> & {
      refusal: RefusalDecision;
    };
    expectTypeOf<
      Pick<TechnicalSeo, 'score' | 'grade' | 'breakdown' | 'refusal'>
    >().toMatchTypeOf<V1Grade>();
  });
  it('coverage reuses the v1 gradeable count and excluded breakdown', () => {
    type V2Coverage = z.infer<typeof CoverageSchema>;
    expectTypeOf<V2Coverage['excluded']>().toEqualTypeOf<CoverageAccounting['excluded']>();
    expectTypeOf<V2Coverage['gradeable']>().toEqualTypeOf<CoverageAccounting['gradeable']>();
  });
});
