/**
 * Owner ruling 2026-11-08, text hidden on phones: only secondary text, never data. Over every account
 * preview, each element a screen keeps out of sight on a phone (`data-v2-phone-secondary`) holds a
 * text the views list as secondary (`lib/v2/view/phone-secondary.ts`), and the first-run fixes'
 * effort, which is data, is not one of them. That a phone shows the effort, and keeps the hidden
 * text in the accessibility tree, is measured in Chrome (`tests/visual/layout.spec.ts`).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import {
  dashboardPreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { phoneSecondaryTexts } from '../../lib/v2/view/phone-secondary';

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
/** A marked element's text, without the separator it opens with (" · marked done Wed"). */
const textOf = (el: Element) => squash(el.textContent ?? '').replace(/^·\s*/, '');
const doc = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

const PAGES = [
  ...(['day0', 'home', 'clean', 'withheld'] as const).map((n) => {
    const data = dashboardPreview(n);
    return {
      name: `dashboard, ${n}`,
      html: renderToStaticMarkup(<DashboardScreen data={data} />),
      secondary: phoneSecondaryTexts(data.shell),
      efforts: (data.topFixes?.rows ?? []).flatMap((r) => (r.effort ? [r.effort] : [])),
    };
  }),
  ...(['home', 'clean', 'withheld'] as const).map((n) => {
    const data = sitePreview(n);
    const shell = shellPreview(n);
    return {
      name: `site, ${n}`,
      html: renderToStaticMarkup(<SiteScreen data={data} shell={shell} />),
      secondary: phoneSecondaryTexts(shell, data),
      efforts: [] as string[],
    };
  }),
];

describe('Text kept out of sight on a phone is secondary, per the view model', () => {
  it.each(PAGES)('$name', (p) => {
    const d = doc(p.html);
    for (const el of d.querySelectorAll('[data-v2-phone-secondary]')) {
      expect(p.secondary, `hidden on a phone: "${textOf(el)}"`).toContain(textOf(el));
    }
    // The effort is data: each one is on the page, and none is marked for hiding.
    const shown = [...d.querySelectorAll('[data-v2-effort]')];
    expect(shown.map(textOf)).toEqual(p.efforts);
    for (const el of shown) expect(el.closest('[data-v2-phone-secondary]')).toBeNull();
  });

  it('reaches what it is about: hidden notes on both screens, and the three day-0 efforts', () => {
    const marked = (name: string) =>
      doc(PAGES.find((p) => p.name === name)!.html).querySelectorAll('[data-v2-phone-secondary]')
        .length;
    expect(marked('dashboard, day0')).toBeGreaterThan(0); // the trial card's note
    expect(marked('site, home')).toBeGreaterThan(1); // the trial card's note and a fix's note
    expect(PAGES.find((p) => p.name === 'dashboard, day0')!.efforts).toHaveLength(3);
  });
});
