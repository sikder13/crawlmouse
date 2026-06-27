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

  it('avoids AA-failing text colors', () => {
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('text-sage'); // score -> ink-muted (sage-on-white ~3.1:1)
    expect(html).not.toContain('text-peach'); // orphan count -> accent-text (peach ~2.6:1)
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
