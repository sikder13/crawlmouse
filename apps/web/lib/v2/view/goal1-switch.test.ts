/**
 * Goal 1 rule 2 on the public pages: a feature named in `V2_HIDE_FEATURES` disappears from Pricing,
 * For agencies, Home, the free check pages and `/llms.txt`, and with the variable unset their output
 * is what it was. The views take the switch's answer as a plain record (`features`); the server entry
 * points call `shownFeatures()`. `/agencies`, `/`, `/check/*` and `/llms.txt` are static, so they
 * read the switch at build time and a change to it takes a redeploy; `/pricing` reads it per request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgenciesScreen } from '../../../components/v2/screens/agencies/AgenciesScreen';
import { HomeScreen } from '../../../components/v2/screens/home/HomeScreen';
import { homePreview } from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { v2KeyPages } from '../../seo/llms-v2';
import { v2LlmsDescriptor } from '../../seo/site-copy';
import type { RiskFeature } from '../../feature-switch';
import { ALL_SHOWN, type Features } from '../features';
import { agenciesView } from './agencies';
import { checkDescription, checkPageView } from './check-pages';
import { pricingView } from './pricing';

vi.mock('server-only', () => ({}));
vi.mock('@/components/analytics/TrackView', () => ({ TrackView: () => null }));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));
const { RISK_FEATURES } = await import('../../feature-switch');

const WEB = join(__dirname, '..', '..', '..');
const NOW = new Date('2026-11-24T12:00:00Z');
const FLAGS = { billing: true, checksPublic: true, accountDoor: true };
const SAMPLE_AGENCY_NAME = 'Summit Digital';

/** Every feature shown, built from the switch's own list rather than from `ALL_SHOWN`. */
const EVERY = Object.fromEntries(RISK_FEATURES.map((f) => [f, true])) as Features;
const hide = (...names: RiskFeature[]): Features => ({
  ...EVERY,
  ...Object.fromEntries(names.map((n) => [n, false])),
});

const pricing = (f?: Features) => pricingView({ kind: 'signed_out' }, 'month', NOW, FLAGS, f);
const agencies = (f?: Features) => agenciesView({ billing: true, accountDoor: true }, f);
const text = (v: unknown) => JSON.stringify(v);
const agenciesHtml = (f: Features) =>
  renderToStaticMarkup(createElement(AgenciesScreen, { data: agencies(f), audit: 'live' }));
const homeHtml = (f?: Features) =>
  renderToStaticMarkup(createElement(HomeScreen, { data: homePreview(f) }));
const words = (html: string) => html.replace(/<[^>]+>/g, ' ');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('nothing hidden', () => {
  it('ALL_SHOWN names the switch’s features, each shown', () => {
    expect(Object.keys(ALL_SHOWN).sort()).toEqual([...RISK_FEATURES].sort());
    expect(Object.values(ALL_SHOWN).every((v) => v === true)).toBe(true);
  });

  it('each view with no record equals the view with every feature passed as shown', () => {
    expect(text(pricing())).toBe(text(pricing(EVERY)));
    expect(text(agencies())).toBe(text(agencies(EVERY)));
    expect(text(homePreview())).toBe(text(homePreview(EVERY)));
    for (const q of ['gptbot', 'javascript', 'robots-ai'] as const) {
      expect(text(checkPageView(q))).toBe(text(checkPageView(q, EVERY)));
      expect(checkDescription(q)).toBe(checkDescription(q, EVERY));
    }
    expect(v2LlmsDescriptor()).toBe(v2LlmsDescriptor(EVERY));
  });

  it('the pages still name competitors, 2,000 pages, client reports and the one-pager', () => {
    expect(text(pricing())).toMatch(/competitor/i);
    expect(text(pricing())).toContain('2,000 pages');
    expect(text(agencies())).toMatch(/client report/i);
    expect(words(agenciesHtml(EVERY))).toContain('The prospect one-pager');
  });
});

describe('the modules a client component can reach import the switch for its type alone', () => {
  // AgencyPlusForm.tsx is 'use client' and imports the pricing copy; 'server-only' would fail it.
  it.each([
    'lib/v2/copy/pricing.ts',
    'lib/v2/view/agencies.ts',
    'lib/v2/view/home.ts',
    'lib/v2/view/check-pages.ts',
    'lib/v2/view/pricing.ts',
    'lib/v2/features.ts',
  ])('%s', (file) => {
    const source = readFileSync(join(WEB, file), 'utf8');
    const imports = [
      ...source.matchAll(
        /^\s*import\b[^;]*?\bfrom\s*['"][^'"]*feature-switch['"]|\bimport\s*\(\s*['"][^'"]*feature-switch['"]/gm,
      ),
    ].map((m) => m[0].trim());
    expect(imports.filter((i) => !/^import\s+type\b/.test(i))).toEqual([]);
  });
});

describe('Pricing and For agencies', () => {
  it('competitors hidden: no competitor sentence on either page', () => {
    expect(text(pricing(hide('competitors')))).not.toMatch(/competitor/i);
    expect(text(agencies(hide('competitors')))).not.toMatch(/competitor/i);
  });

  it('pages_2000 hidden: paid plans say the free page limit, and 2,000 appears nowhere', () => {
    const t = text(pricing(hide('pages_2000')));
    expect(t).not.toContain('2,000');
    expect(t).toContain('Up to 500 pages per audit');
  });

  it('staging_deploys hidden: no staging or preview sentence', () => {
    expect(text(pricing())).toMatch(/staging/i);
    expect(text(pricing(hide('staging_deploys')))).not.toMatch(/staging|preview URL/i);
  });

  it('rendering hidden: no renders row', () => {
    expect(text(pricing())).toContain('Full JavaScript renders');
    expect(text(pricing(hide('rendering')))).not.toContain('Full JavaScript renders');
  });

  it('ai_letter hidden: the crawler line names no grade', () => {
    expect(text(pricing().crawlers)).toContain('count towards your grade');
    expect(text(pricing(hide('ai_letter')).crawlers)).not.toMatch(/grade/i);
  });

  it('ai_letter hidden: the one-pager sample shows Technical SEO alone', () => {
    expect(agencies().onePager.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
      'AI readability',
    ]);
    expect(agencies(hide('ai_letter')).onePager.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
    ]);
    expect(words(agenciesHtml(hide('ai_letter')))).not.toContain('AI readability');
  });

  it('agency_domain hidden: no "emails from your address" on either page', () => {
    expect(text(pricing())).toMatch(/emails from your address/i);
    expect(text(agencies())).toMatch(/emails from your address/i);
    expect(text(pricing(hide('agency_domain')))).not.toMatch(/emails from your address/i);
    expect(text(agencies(hide('agency_domain')))).not.toMatch(/emails from your address/i);
  });

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: the Agency card keeps a description that names no hidden feature',
    (name) => {
      const card = pricing(hide(name)).plans.find((p) => p.tier === 'agency')!;
      expect(card.description.hidden).toBe(false);
      expect(card.description.text).not.toBe('');
      expect(card.description.text).not.toMatch(/report|brand|logo|domain|own name/i);
    },
  );

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: For agencies renders no one-pager section and no empty heading',
    (name) => {
      const html = agenciesHtml(hide(name));
      expect(words(html)).not.toContain('The prospect one-pager');
      expect(html).not.toContain(SAMPLE_AGENCY_NAME);
      expect(html).not.toMatch(/<h[1-6][^>]*>\s*<\/h[1-6]>/);
    },
  );

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: the description and the /llms.txt line drop the branded reports',
    (name) => {
      vi.stubEnv('V2_BILLING', '1');
      expect(agencies().description).toContain('branded client reports are coming');
      const description = agencies(hide(name)).description;
      expect(description).not.toMatch(/branded|client report/i);
      expect(description).toContain('client sites');
      const line = v2KeyPages(hide(name)).find(([, path]) => path === '/agencies')!;
      expect(line[2]).toBe(description);
    },
  );
});

describe('Home', () => {
  it('nothing hidden: the locked plan cards, the words card, the text column and the legend', () => {
    const t = words(homeHtml());
    expect(t).toContain('alerts to Slack, one competitor per site, PDF and CSV export.');
    expect(t).toContain(
      'Twenty-five client sites, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.',
    );
    expect(t).toContain('A browser sees');
    expect(t).toContain('Text it can read');
    expect(t).toContain('only through JavaScript');
  });

  it('competitors, the agency features and nojs hidden: none of them is named', () => {
    const t = words(homeHtml(hide('competitors', 'agency_domain', 'agency_white_label', 'nojs')));
    expect(t).not.toMatch(/competitor/i);
    expect(t).toContain('Twenty-five client sites and five seats.');
    expect(t).not.toContain('A browser sees');
    expect(t).not.toContain('run JavaScript. How much');
  });

  it('agency_domain alone hidden: the one-page audit stays, the domain and logo go', () => {
    expect(words(homeHtml(hide('agency_domain')))).toContain(
      'Twenty-five client sites, five seats, and a one-page audit you can hand to a prospect.',
    );
  });

  it('agency_white_label alone hidden: the domain and logo stay, the one-page audit goes', () => {
    expect(words(homeHtml(hide('agency_white_label')))).toContain(
      'Twenty-five client sites, five seats, and reports on your domain with your logo.',
    );
  });

  it('nojs hidden: the crawler table drops its text column whole, and the legend its item', () => {
    const html = homeHtml(hide('nojs'));
    expect(words(html)).not.toContain('Text it can read');
    expect(words(html)).not.toContain('only through JavaScript');
    expect(homePreview(hide('nojs')).crawlers.rows.every((r) => r.text === null)).toBe(true);
    // The header and each row have the same number of cells: four, with the column gone.
    const table = html.slice(html.indexOf('What each crawler got back'));
    const head = table.slice(0, table.indexOf('</thead>'));
    const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
    expect((head.match(/<th\b/g) ?? []).length).toBe(4);
    const rows = body.split('</tr>').filter((r) => /<t[dh]\b/.test(r));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect((r.match(/<t[dh]\b/g) ?? []).length).toBe(4);
  });

  it('ai_letter hidden: the example shows Technical SEO alone', () => {
    expect(homePreview().example.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
      'AI readability',
    ]);
    expect(homePreview(hide('ai_letter')).example.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
    ]);
  });
});

describe('the free check pages and /llms.txt', () => {
  it('nothing hidden: the grade sentence and the per-page figure are there', () => {
    expect(text(checkPageView('gptbot'))).toContain('AI readability grade');
    expect(text(checkPageView('javascript'))).toContain('page by page, and gives you the number');
    expect(checkDescription('javascript')).toContain('page by page');
    expect(v2LlmsDescriptor()).toContain('AI readability');
  });

  it('ai_letter hidden: /check/gptbot names no grade, and the descriptor no AI readability', () => {
    expect(text(checkPageView('gptbot', hide('ai_letter')))).not.toMatch(/readability grade/i);
    expect(v2LlmsDescriptor(hide('ai_letter'))).not.toContain('AI readability');
    expect(v2LlmsDescriptor(hide('ai_letter'))).toContain('grades SEO');
  });

  it('nojs hidden: /check/javascript promises no per-page figure, keeps its h1 and title', () => {
    const p = text(checkPageView('javascript', hide('nojs')));
    expect(p).not.toContain('gives you the number');
    expect(p).toContain('Can AI crawlers read your site without JavaScript?');
    expect(p).toContain('shows you what each one is served');
    const description = checkDescription('javascript', hide('nojs'));
    expect(description).not.toMatch(/page by page|how much/i);
    const find = (pages: ReturnType<typeof v2KeyPages>) =>
      pages.find(([, path]) => path === '/check/javascript')!;
    const line = find(v2KeyPages(hide('nojs')));
    expect(line[0]).toBe(find(v2KeyPages())[0]);
    expect(line[2]).toBe(description);
  });
});

describe('the server entry points read the switch', () => {
  it('/agencies: its meta, Open Graph and Twitter text under agency_white_label', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_HIDE_FEATURES', 'agency_white_label');
    const { metadata } = await import('../../../app/agencies/page');
    const all = JSON.stringify([
      metadata.description,
      metadata.openGraph?.description,
      metadata.twitter?.description,
    ]);
    expect(all).toContain('client sites');
    expect(all).not.toMatch(/branded|client report/i);
    expect(metadata.title).toBe('For agencies');
  });

  it('/check/javascript: its meta description under nojs, the title kept', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const { generateMetadata } = await import('../../../app/check/[question]/page');
    const m = await generateMetadata({ params: Promise.resolve({ question: 'javascript' }) });
    expect(m.description).toBe(checkDescription('javascript', hide('nojs')));
    expect(m.openGraph?.description).toBe(m.description);
    expect(m.title).toBe('AI crawlers and JavaScript: AI visibility check');
  });

  it('/llms.txt: the descriptor and the key pages under ai_letter and nojs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_HIDE_FEATURES', 'ai_letter,nojs');
    const { GET } = await import('../../../app/llms.txt/route');
    const body = await GET().text();
    expect(body).toContain(v2LlmsDescriptor(hide('ai_letter')));
    expect(body).not.toContain('grades SEO and AI readability');
    expect(body).toContain(checkDescription('javascript', hide('nojs')));
  });

  it('Home: LiveHome hides what the switch hides', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const { LiveHome } = await import('../../../components/v2/screens/home/LiveHome');
    const html = renderToStaticMarkup(createElement(LiveHome));
    expect(words(html)).toContain('Homepage');
    expect(words(html)).not.toContain('Text it can read');
  });
});
