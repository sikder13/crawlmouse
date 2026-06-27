import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge';

const md = (tone: Parameters<typeof Badge>[0]['tone']) =>
  renderToStaticMarkup(<Badge tone={tone}>x</Badge>);

describe('Badge — AA tones + status tones', () => {
  it('saturated fills use white text on darkened *-fill tokens', () => {
    const peach = md('peach');
    expect(peach).toContain('bg-accent-fill');
    expect(peach).toContain('text-white');
    const sage = md('sage');
    expect(sage).toContain('bg-sage-fill');
    expect(sage).toContain('text-white');
  });

  it('ink tone keeps cream-on-ink (high contrast)', () => {
    const html = md('ink');
    expect(html).toContain('bg-ink');
    expect(html).toContain('text-cream');
  });

  it('status tones: success/warning are white-on-fill; info/neutral are light-tint + ink', () => {
    expect(md('success')).toContain('bg-sage-fill');
    expect(md('success')).toContain('text-white');
    expect(md('warning')).toContain('bg-warning-fill');
    expect(md('warning')).toContain('text-white');
    expect(md('info')).toContain('bg-peach-light');
    expect(md('info')).toContain('text-ink');
    expect(md('neutral')).toContain('bg-oat');
    expect(md('neutral')).toContain('text-ink');
  });
});
