import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricingCards } from './PricingCards';

describe('PricingCards', () => {
  const html = renderToStaticMarkup(<PricingCards monthlyPriceId="m" yearlyPriceId="y" />);

  it('Pro leads with VALUE (fixes, packets, monitoring) before volume (D4)', () => {
    const fixIdx = html.indexOf('Every fix');
    const packetIdx = html.indexOf('action packets');
    const climbIdx = html.indexOf('watch your grade climb');
    const volumeIdx = html.indexOf('2,000');
    expect(fixIdx).toBeGreaterThan(-1);
    expect(packetIdx).toBeGreaterThan(-1);
    expect(climbIdx).toBeGreaterThan(-1);
    expect(volumeIdx).toBeGreaterThan(-1);
    // every value beat appears before the page-cap (volume) line
    expect(fixIdx).toBeLessThan(volumeIdx);
    expect(packetIdx).toBeLessThan(volumeIdx);
    expect(climbIdx).toBeLessThan(volumeIdx);
  });

  it('Free shows the real free experience (grade + one complete fix)', () => {
    expect(html).toContain('One complete fix');
    expect(html).toContain('letter grade');
  });

  it('annual is the default with the 2-months-free framing', () => {
    expect(html).toContain('$190');
    expect(html).toContain('2 months free');
  });
});
