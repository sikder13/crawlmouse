import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge';

const md = (tone: Parameters<typeof Badge>[0]['tone']) =>
  renderToStaticMarkup(<Badge tone={tone}>x</Badge>);

describe('Badge — AA tones + status tones', () => {
  it('grade tones use AA-safe ink text on light fills (never white)', () => {
    const peach = md('peach');
    expect(peach).toContain('bg-peach');
    expect(peach).toContain('text-ink');
    expect(peach).not.toContain('text-white'); // white-on-peach ~2.6:1 fails AA
    expect(md('sage')).not.toContain('text-white'); // white-on-sage ~3.1:1 fails AA-normal
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
