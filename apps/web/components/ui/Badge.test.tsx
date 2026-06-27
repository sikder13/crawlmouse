import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge';

const md = (tone: Parameters<typeof Badge>[0]['tone']) =>
  renderToStaticMarkup(<Badge tone={tone}>x</Badge>);

describe('Badge — AA tones + status tones', () => {
  it('peach badge uses white text on the AA accent-fill; sage stays ink', () => {
    const peach = md('peach');
    expect(peach).toContain('bg-accent-fill');
    expect(peach).toContain('text-white');
    expect(md('sage')).toContain('text-ink');
    expect(md('sage')).not.toContain('text-white'); // white-on-sage ~3.1:1 fails AA
  });

  it('ink tone keeps cream-on-ink (high contrast)', () => {
    const html = md('ink');
    expect(html).toContain('bg-ink');
    expect(html).toContain('text-cream');
  });

  it('adds AA status tones (success / warning / info / neutral)', () => {
    expect(md('success')).toContain('bg-sage');
    expect(md('warning')).toContain('bg-warning');
    expect(md('info')).toContain('bg-peach-light');
    expect(md('neutral')).toContain('bg-oat');
    expect(md('warning')).toContain('text-ink');
  });
});
