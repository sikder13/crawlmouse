import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { GradeReveal } from './GradeReveal';
import { estimateFixture, freeFixture } from './__fixtures__/client-audit-v2';

describe('GradeReveal', () => {
  it('reveals the grade via the gauge with tier framing, impulse share, and explainer', () => {
    const html = renderToStaticMarkup(
      <GradeReveal
        grade="C"
        score={64}
        orphanCount={7}
        avgDepth={3.2}
        confidenceBand={freeFixture.confidenceBand}
        achievableGrade="B+"
        auditId="aud-x"
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Your grade is C');
    expect(html).toContain('role="img"'); // the gauge
    expect(html).toContain('Solid, with room to climb'); // C = fair tier framing
    expect(html).toContain('B+'); // achievable-grade climb adjacent to the gauge
    expect(html).toContain('achievable');
    expect(html).toContain('Get your free report'); // impulse share → the get-report CTA (compact, §5)
    expect(html).toContain('What does this grade measure?');
    expect(html).not.toContain('Estimate'); // confident, not an estimate
  });

  // SPEC 04.2 FIX 4 — the report path must be a PROMINENT primary CTA on the top grade card (where the eye
  // lands after the grade), not a bare button that reads as a share action. Pre-mint (no /r/ slug yet) it
  // leads with "Get your free report" + a value prop; the "Share it:" channel row only appears post-mint.
  it('pre-mint, leads with a prominent "Get your free report" CTA + value prop, not a share row (FIX 4)', () => {
    const html = renderToStaticMarkup(
      <GradeReveal grade="C" score={64} orphanCount={7} avgDepth={3.2} confidenceBand={freeFixture.confidenceBand} achievableGrade="B+" auditId="aud-x" />,
    );
    expect(html).toContain('Get your free report'); // the report path is on the top grade card…
    expect(html).toMatch(/client-ready/i); // …framed as a prominent primary CTA (value prop), not a lone share button
    expect(html).not.toContain('Share it:'); // pre-mint shows the report CTA, not the post-mint share-channel row
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
