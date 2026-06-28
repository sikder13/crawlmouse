import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeatureCards } from './FeatureCards';

const html = renderToStaticMarkup(<FeatureCards />);

describe('FeatureCards (homepage, educational)', () => {
  it('renders the three features, each with an expandable explainer', () => {
    expect(html).toContain('Live link graph');
    expect(html).toContain('A–F letter grade');
    expect(html).toContain('Peer benchmarks');
    expect((html.match(/<details/g) ?? []).length).toBe(3);
  });

  it('explains internal linking + the four grade components in plain language', () => {
    expect(html).toContain('What is internal linking?');
    expect(html).toContain('Orphans (40%)');
    expect(html).toContain('Click depth (20%)');
    expect(html).toContain('Anchor diversity (20%)');
    expect(html).toContain('Structure (20%)');
  });
});
