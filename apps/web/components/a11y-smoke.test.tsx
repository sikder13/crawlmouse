import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { Button, buttonClasses } from './ui/Button';
import { Input } from './ui/Input';
import { GradeReveal } from './audit/GradeReveal';

// U11 — the a11y guarantees that aren't visible in a screenshot: a visible keyboard focus ring on
// every control, motion that yields to prefers-reduced-motion, and the grade announced to screen
// readers via a live region.
describe('a11y smoke (U11)', () => {
  it('Button exposes a focus-visible ring + respects reduced motion', () => {
    const html = renderToStaticMarkup(<Button>Go</Button>);
    expect(html).toContain('focus-visible:ring');
    expect(html).toContain('motion-reduce:transition-none');
  });

  it('a link styled as a button carries the same focus ring (no nested button)', () => {
    expect(buttonClasses()).toContain('focus-visible:ring');
    expect(buttonClasses()).toContain('no-underline');
  });

  it('Input exposes a focus-visible ring + respects reduced motion', () => {
    const html = renderToStaticMarkup(<Input aria-label="Email" />);
    expect(html).toContain('focus-visible:ring');
    expect(html).toContain('motion-reduce:transition-none');
  });

  it('GradeReveal announces the grade in a live region + reveal honors reduced motion', () => {
    const html = renderToStaticMarkup(
      <GradeReveal grade="B" score={84} orphanCount={2} avgDepth={1.5} />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Your grade is B'); // the announced sentence
    expect(html).toContain('motion-reduce:animate-none');
  });
});
