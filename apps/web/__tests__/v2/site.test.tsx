/**
 * The site page against Final-Site: the visible text outside the rail equals the locked HTML with
 * the registered changes (lib/v2/copy/site.ts) and nothing else, one orange element, and glyph
 * cells that carry their words. The alert switches: site-alerts.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import { shellPreview, sitePreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (name: Parameters<typeof sitePreview>[0]) =>
  renderToStaticMarkup(<SiteScreen data={sitePreview(name)} shell={shellPreview(name)} />);
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];

describe('Final-Site, example-outfitter.com', () => {
  const html = render('home');

  it('reads as the locked HTML outside the rail, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Site.dc.html')).rest, 'site'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('gives every glyph cell its verdict in words, so no cell is a bare glyph (DESIGN-LOCK §7.6)', () => {
    const doc = new JSDOM(html).window.document;
    const cells = [...doc.querySelectorAll('[data-v2-check-glyph]')];
    expect(cells).toHaveLength(8 * 6);
    for (const c of cells) expect(c.querySelector('[data-v2-sr-only]')?.textContent).toBeTruthy();
  });
});

describe.each(['home', 'clean', 'withheld'] as const)('Site, %s', (name) => {
  it('has exactly one orange element, in the header', () => {
    const html = render(name);
    expect(primaries(html)).toHaveLength(1);
    expect(primaries(html.slice(html.indexOf('<header'), html.indexOf('</header>')))).toHaveLength(
      1,
    );
  });
});
