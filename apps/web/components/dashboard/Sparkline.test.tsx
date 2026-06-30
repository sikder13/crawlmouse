import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('renders an accessible polyline for the score history', () => {
    const html = renderToStaticMarkup(<Sparkline scores={[58, 69, 81]} />);
    expect(html).toContain('<polyline');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Grade over time"');
  });

  it('renders nothing for an empty history', () => {
    expect(renderToStaticMarkup(<Sparkline scores={[]} />)).toBe('');
  });
});
