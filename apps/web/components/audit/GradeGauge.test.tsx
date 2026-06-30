import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeGauge } from './GradeGauge';

describe('GradeGauge', () => {
  it('is accessible: letter + number + tier icon, never color-only (SSR = final value)', () => {
    const html = renderToStaticMarkup(<GradeGauge grade="C" score={64} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Grade C, 64 out of 100"');
    expect(html).toContain('>C<'); // serif letter
    expect(html).toContain('64/100'); // number at the final value (no-JS safe)
    expect(html).toContain('↗'); // fair tier icon
    expect(html).toContain('text-peach'); // fair tier arc (the reserved orange)
  });

  it('a strong grade settles sage/check; a weak grade warning/bang', () => {
    const strong = renderToStaticMarkup(<GradeGauge grade="A-" score={91} />);
    expect(strong).toContain('text-sage');
    expect(strong).toContain('✓');
    const weak = renderToStaticMarkup(<GradeGauge grade="F" score={32} />);
    expect(weak).toContain('text-warning');
    expect(weak).toContain('!');
  });

  it('compact (sm) renders a prominent, tier-colored letter + tier ring, no big number', () => {
    const html = renderToStaticMarkup(<GradeGauge grade="B" score={84} size="sm" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('>B<');
    expect(html).toContain('text-h2'); // letter is a touch more prominent than the old text-h3
    expect(html).toContain('text-sage-fill'); // B letter reads green-good (AA-safe)
    expect(html).toContain('text-sage'); // strong tier ring
    expect(html).not.toContain('/100'); // compact omits the number
  });

  it('compact (sm) colors the letter amber for a C (needs-work, AA-safe)', () => {
    const html = renderToStaticMarkup(<GradeGauge grade="C" score={64} size="sm" />);
    expect(html).toContain('text-accent-text');
  });
});
