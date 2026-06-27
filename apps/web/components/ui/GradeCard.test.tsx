import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeCard } from './GradeCard';
import { GradeCardSkeleton } from './GradeCardSkeleton';

describe('GradeCard — elevated, backward-compatible (U13)', () => {
  // r/[slug] (non-owned) renders with exactly this legacy prop set — structure preserved.
  const html = renderToStaticMarkup(
    <GradeCard grade="B-" score={76} orphanCount={3} avgDepth={2.4} passing />,
  );

  it('renders grade, score, and both metrics from the legacy props', () => {
    expect(html).toContain('>B-<');
    expect(html).toContain('76');
    expect(html).toContain('100');
    expect(html).toContain('>3<');
    expect(html).toContain('>2.4<');
    expect(html).toContain('orphan pages');
    expect(html).toContain('avg click depth');
  });

  it('uses the lg card size (no !important radius/padding hacks)', () => {
    expect(html).toContain('rounded-card-lg');
    expect(html).toContain('p-7');
    expect(html).not.toContain('!p-7');
    expect(html).not.toContain('!rounded');
  });

  it('uses AA text-on-cream colors; badge is white on the darkened sage-fill', () => {
    expect(html).toContain('text-ink-muted'); // score + labels
    expect(html).toContain('text-accent-text'); // orphan count (AA-large)
    expect(html).not.toContain('text-sage'); // never sage *text* on white
    expect(html).not.toContain('text-peach'); // never peach *text* on white
    expect(html).toContain('bg-sage-fill'); // passing badge = white on darkened sage-fill
  });
});

describe('GradeCardSkeleton — reduced-motion safe', () => {
  const html = renderToStaticMarkup(<GradeCardSkeleton />);
  it('keeps busy semantics, uses lg size, and disables motion under reduce', () => {
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('animate-pulse');
    expect(html).toContain('motion-reduce:animate-none');
    expect(html).toContain('rounded-card-lg');
  });
});
