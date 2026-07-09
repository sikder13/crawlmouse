import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { WhiteLabelControls } from './WhiteLabelControls';

const noop = () => {};

// U3 — the white-label control is the single most important Pro gap. A FREE owner sees it LOCKED with an
// upgrade CTA (never hidden — a visible value driver; and the server rejects a forced write regardless).
// A PRO owner gets the editable form. U4 — the file input pre-checks type client-side, but the server is
// the authoritative gate.
describe('WhiteLabelControls', () => {
  it('free owner (canWhiteLabel=false) → LOCKED with an upgrade-to-Pro CTA, no editable input', () => {
    const html = renderToStaticMarkup(
      <WhiteLabelControls slug="abc" canWhiteLabel={false} whiteLabel={null} onSaved={noop} onEnabled={noop} />,
    );
    expect(html).toContain('Your branding');
    expect(html).toMatch(/upgrade to pro/i);
    expect(html).toContain('/pricing');
    expect(html).not.toContain('name="brandName"'); // free owner gets no functional brand input
  });

  it('Pro owner (canWhiteLabel=true) → the editable form (brand name + logo file input)', () => {
    const html = renderToStaticMarkup(
      <WhiteLabelControls slug="abc" canWhiteLabel whiteLabel={null} onSaved={noop} onEnabled={noop} />,
    );
    expect(html).toContain('Your branding');
    expect(html).toContain('name="brandName"');
    expect(html).toContain('type="file"');
    expect(html).toContain('image/png'); // accept attr lists the allowed types (no SVG)
    expect(html).not.toMatch(/upgrade to pro/i);
  });

  it('Pro owner with an existing brand seeds the input and offers a turn-off control', () => {
    const html = renderToStaticMarkup(
      <WhiteLabelControls slug="abc" canWhiteLabel whiteLabel={{ brandName: 'Acme Co', logoPath: null }} onSaved={noop} onEnabled={noop} />,
    );
    expect(html).toContain('Acme Co'); // seeded brand-name value
    expect(html).toMatch(/turn off/i);
  });
});
