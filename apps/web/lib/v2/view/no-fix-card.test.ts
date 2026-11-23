import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noFixKind, servedWord } from './no-fix-card';

const facts = fc.record({
  pagesAnswered: fc.nat({ max: 5 }),
  pagesServed: fc.nat({ max: 5 }),
  graded: fc.boolean(),
  aiUnmeasured: fc.nat({ max: 6 }),
  everySectionMeasured: fc.boolean(),
});

describe('what the third card says when a check has no fix', () => {
  it('says all-clear exactly when a page was served and everything was measured', () => {
    fc.assert(
      fc.property(facts, (f) => {
        const measured = f.pagesServed > 0 && f.aiUnmeasured === 0 && f.everySectionMeasured;
        expect(noFixKind(f) === 'all-clear').toBe(measured);
      }),
    );
  });

  it('says not-served exactly when pages answered, none with a 200, and no letter was given', () => {
    fc.assert(
      fc.property(facts, (f) => {
        expect(noFixKind(f) === 'not-served').toBe(
          f.pagesAnswered > 0 && f.pagesServed === 0 && !f.graded,
        );
      }),
    );
  });

  it.each([
    [
      'one crawler not measured',
      {
        pagesAnswered: 3,
        pagesServed: 3,
        graded: false,
        aiUnmeasured: 1,
        everySectionMeasured: true,
      },
    ],
    [
      'text not measured',
      {
        pagesAnswered: 3,
        pagesServed: 3,
        graded: false,
        aiUnmeasured: 0,
        everySectionMeasured: false,
      },
    ],
    [
      'no page rows to read',
      {
        pagesAnswered: 0,
        pagesServed: 0,
        graded: false,
        aiUnmeasured: 0,
        everySectionMeasured: true,
      },
    ],
  ])('is unmeasured with %s', (_name, f) => {
    expect(noFixKind(f)).toBe('unmeasured');
  });
});

describe('the word for pages that were not served', () => {
  it.each([[[403]], [[401, 403]], [[429]], [[403, 451]]])('%j is a refusal', (codes) => {
    expect(servedWord(codes)).toBe('refused');
  });

  it.each([[[404]], [[500]], [[403, 404]], [[503]], [[301]]])(
    '%j is not called a refusal',
    (codes) => {
      expect(servedWord(codes)).toBe('not-served');
    },
  );
});
