import type { HomeScreenData } from '../../../../components/v2/screens/types';

/**
 * The example audit on the locked Home screen (docs/design/v2/screens/Final-Home.dc.html), value
 * for value. Interim: CC-11's frozen fixtures (apps/web/lib/fixtures/v2) replace this once merged.
 */
export const HOME_FIXTURE: HomeScreenData = {
  example: {
    domain: 'example-outfitter.com',
    duration: '2 min 11 s',
    pagesCrawled: 214,
    pagesTotal: 214,
    links: 779,
    grades: [
      {
        label: 'Technical SEO',
        letter: 'B',
        score: 79,
        tone: 'default',
        summary: '7 orphan pages. Three fixes take it to A-.',
      },
      {
        label: 'AI visibility',
        letter: 'D',
        score: 41,
        tone: 'bad',
        summary:
          'GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page. Product pages are empty without JavaScript.',
      },
    ],
  },
  crawlers: {
    productPages: 158,
    rows: [
      {
        crawler: 'Googlebot',
        homepage: { state: 'ok', label: '200' },
        productPages: { state: 'ok', label: '200' },
        textPercent: 100,
        obstacle: 'nothing, it renders JavaScript',
      },
      {
        crawler: 'GPTBot',
        homepage: { state: 'bad', label: '403' },
        productPages: { state: 'bad', label: '403' },
        textPercent: 0,
        obstacle: 'a Cloudflare firewall rule',
      },
      {
        crawler: 'ClaudeBot',
        homepage: { state: 'ok', label: '200' },
        productPages: { state: 'warn', label: 'empty shell' },
        textPercent: 31,
        obstacle: 'the product template is client-rendered',
      },
      {
        crawler: 'PerplexityBot',
        homepage: { state: 'bad', label: 'challenge' },
        productPages: { state: 'bad', label: 'challenge' },
        textPercent: 0,
        obstacle: 'Bot Fight Mode',
      },
    ],
  },
  withoutJs: {
    path: '/products/ridge-2p',
    browserWords: 1120,
    bot: 'GPTBot',
    botWords: 134,
    templatePages: 158,
  },
  alert: {
    title: 'ClaudeBot is now blocked',
    time: 'Tue 08:12',
    domain: 'example-outfitter.com',
    changedFile: 'robots.txt',
    changedAt: '07:40',
    pagesAffected: 214,
    diff: { context: 'User-agent: ClaudeBot', removed: 'Allow: /', added: 'Disallow: /' },
  },
};
