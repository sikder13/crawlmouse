import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeReveal } from './GradeReveal';
import { estimateFixture, freeFixture } from './__fixtures__/client-audit-v2';

describe('GradeReveal', () => {
  it('reveals a confident grade with a live-region announce + the grade explainer', () => {
    const html = renderToStaticMarkup(
      <GradeReveal grade="C" score={64} orphanCount={7} avgDepth={3.2} confidenceBand={freeFixture.confidenceBand} />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Your grade is C');
    expect(html).toContain('What does this grade measure?');
    expect(html).not.toContain('Estimate'); // confident, not an estimate
  });

  it('estimate: Estimate badge, basis, range explainer, and an estimate announce (U4)', () => {
    const html = renderToStaticMarkup(
      <GradeReveal
        grade="B"
        score={84}
        orphanCount={7}
        avgDepth={null}
        confidenceBand={estimateFixture.confidenceBand}
      />,
    );
    expect(html).toContain('Estimate');
    expect(html).toContain('based on 70 of ~500 pages');
    expect(html).toContain('Why is this an estimate?');
    expect(html).toContain('Estimated grade B');
  });
});
