import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  // SPEC 04.2 FIX 2 — the post-save copy used to promise a silent background update ("your report will show
  // it in a moment"), giving the owner nothing to click. It now links STRAIGHT to the (already cache-purged)
  // report. The async save handler isn't renderable without interaction infra (none in this repo — writes are
  // exercised in the live smoke), so pin the wiring at the source, mirroring spec04-white-label-guard.
  it('post-save copy links to the report and drops the vague "in a moment" promise (FIX 2)', () => {
    const src = readFileSync(resolve(__dirname, 'WhiteLabelControls.tsx'), 'utf8');
    expect(src).toContain('/r/${slug}'); // links straight to the report
    expect(src).not.toContain('in a moment'); // no silent-background-update promise
  });
});
