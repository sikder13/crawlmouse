import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveAndMonitorCta } from './SaveAndMonitorCta';

describe('SaveAndMonitorCta (free-tier STAY beat)', () => {
  it('invites a signed-out viewer to save + monitor, linking to signup', () => {
    const html = renderToStaticMarkup(<SaveAndMonitorCta />);
    expect(html).toContain('Keep an eye on this grade');
    expect(html).toContain('monitor');
    expect(html).toContain('watch your grade climb');
    expect(html).toContain('/login');
  });
});
