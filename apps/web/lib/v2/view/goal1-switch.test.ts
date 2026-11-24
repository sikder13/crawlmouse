/**
 * Goal 1 rule 2 on the public pages: a feature named in `V2_HIDE_FEATURES` disappears from Pricing
 * and For agencies, and nothing else changes. With the variable unset both pages read as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RISK_FEATURES } from '../../feature-switch';
import { CAPABILITIES } from './agencies';
import { agenciesView } from './agencies';
import { pricingView } from './pricing';

const NOW = new Date('2026-11-24T12:00:00Z');
const FLAGS = { billing: true, checksPublic: true } as Parameters<typeof pricingView>[3];

const pricingText = () => JSON.stringify(pricingView({ kind: 'signed_out' }, 'month', NOW, FLAGS));
const agenciesText = () => JSON.stringify(agenciesView({ billing: true, accountDoor: true }));

afterEach(() => vi.unstubAllEnvs());

describe('the switch on Pricing and For agencies', () => {
  it('unset, the pages still name competitors, 2,000 pages and client reports', () => {
    expect(pricingText()).toMatch(/competitor/i);
    expect(pricingText()).toContain('2,000 pages');
    expect(agenciesText()).toMatch(/client report/i);
  });

  it('competitors hidden: no competitor sentence on either page', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors');
    expect(pricingText()).not.toMatch(/competitor/i);
    expect(agenciesText()).not.toMatch(/competitor/i);
  });

  it('pages_2000 hidden: paid plans say the free page limit, and 2,000 appears nowhere', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'pages_2000');
    expect(pricingText()).not.toContain('2,000');
    expect(agenciesText()).not.toContain('2,000');
    expect(pricingText()).toContain('Up to 500 pages per audit');
  });

  it('staging_deploys hidden: no staging or preview sentence', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'staging_deploys');
    expect(pricingText()).not.toMatch(/staging|preview URL/i);
  });

  it('every RISK capability names a feature the switch knows', () => {
    for (const [key, c] of Object.entries(CAPABILITIES))
      if (c.risk) expect(RISK_FEATURES, key).toContain(c.risk);
  });

  it('every name the switch knows hides something on these pages, or is said to be elsewhere', () => {
    const onThesePages = new Set(
      Object.values(CAPABILITIES).flatMap((c) => (c.risk ? [c.risk] : [])),
    );
    onThesePages.add('pages_2000');
    const elsewhere = RISK_FEATURES.filter((f) => !onThesePages.has(f));
    // Named on the result and home screens, not in these capability tables.
    expect(elsewhere.sort()).toEqual(['ai_letter', 'nojs', 'sentinel']);
  });
});

describe('the switch on Home', () => {
  const home = async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { HomeScreen } = await import('../../../components/v2/screens/home/HomeScreen');
    const { homePreview } = await import('../../../app/(v2-preview)/v2-preview/_preview/screens');
    const data = homePreview();
    return renderToStaticMarkup(HomeScreen({ data }) as never).replace(/<[^>]+>/g, ' ');
  };

  it('unset: the locked plan cards and the words card', async () => {
    const t = await home();
    expect(t).toContain('alerts to Slack, one competitor per site, PDF and CSV export.');
    expect(t).toContain(
      'Twenty-five client sites, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.',
    );
    expect(t).toContain('A browser sees');
  });

  it('hidden: no competitor, no logo or one-page audit, no words card', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors,agency_domain,agency_white_label,nojs');
    const t = await home();
    expect(t).not.toMatch(/competitor/i);
    expect(t).toContain('Twenty-five client sites and five seats.');
    expect(t).not.toContain('A browser sees');
    expect(t).not.toContain('run JavaScript. How much');
  });
});

describe('the AI readability letter on Home', () => {
  it('unset: the example audit shows both grades', async () => {
    const { homePreview } = await import('../../../app/(v2-preview)/v2-preview/_preview/screens');
    expect(homePreview().example.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
      'AI readability',
    ]);
  });

  it('ai_letter hidden: only Technical SEO', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'ai_letter');
    const { homePreview } = await import('../../../app/(v2-preview)/v2-preview/_preview/screens');
    expect(homePreview().example.grades.map((g) => g.label)).toEqual(['Technical SEO']);
  });
});

describe('the free check pages under the switch', () => {
  const page = async (q: 'gptbot' | 'javascript') => {
    const { checkPageView } = await import('./check-pages');
    return JSON.stringify(checkPageView(q));
  };

  it('unset: the grade sentence and the per-page figure are there', async () => {
    expect(await page('gptbot')).toContain('AI readability grade');
    expect(await page('javascript')).toContain('page by page, and gives you the number');
  });

  it('ai_letter hidden: /check/gptbot names no grade', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'ai_letter');
    expect(await page('gptbot')).not.toMatch(/readability grade/i);
  });

  it('nojs hidden: /check/javascript promises no per-page figure, and keeps its h1', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const p = await page('javascript');
    expect(p).not.toContain('gives you the number');
    expect(p).toContain('Can AI crawlers read your site without JavaScript?');
    expect(p).toContain('shows you what each one is served');
  });
});
