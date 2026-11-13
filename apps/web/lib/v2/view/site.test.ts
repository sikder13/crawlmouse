/** The site page's view model against values worked out by hand from the fixtures. */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { axisLabels, move } from './checks';
import { siteView } from './site';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const C9 = 'a0000000-0000-4000-8000-0000000000c9';
const GRANITEPEAK = '50000000-0000-4000-8000-0000000000c9';
const bad = fixture('bad-site');

describe('a score’s move', () => {
  it('is given to the two decimals a score has, with the locked minus sign, and says no change', () => {
    expect([move(80, 79), move(22, 25), move(79, 79)]).toEqual(['−1', '+3', 'no change']);
    // The engine's scores have decimals: their difference as a float is not a number to print.
    expect(82.24 - 81.77).not.toBe(0.47);
    expect(move(81.77, 82.24)).toBe('+0.47');
    expect(move(82.24, 81.77)).toBe('−0.47');
    expect(move(70.1, 70.1 + 0.001)).toBe('no change');
  });
});

describe('Site page, example-outfitter.com at as_of', () => {
  const v = siteView(bad, { accountId: BAD_ACCOUNT, now: bad.as_of }, OUTFITTER);

  it('counts sixteen fixes: thirteen from the first audit and three first seen at Friday’s check', () => {
    expect(v.header.title).toBe('example-outfitter.com');
    expect(v.header.line).toBe(
      "Fri 30 Oct · last check today 06:02 · next Fri 6 Nov around 06:00 · 214 pages · 16 fixes: the 13 from the audit plus 3 new at Friday's check",
    );
  });

  it('opens the newest crawler fix as its one orange action', () => {
    // Fix 0 (Claude-SearchBot, +19 AI) is the highest-ranked of the three new fixes.
    expect(v.header.actions.filter((a) => a.primary).map((a) => a.label)).toEqual([
      'Open the Claude-SearchBot packet · +19 AI',
    ]);
  });

  it('gives both grades, their move since Thursday and their parts', () => {
    expect(v.grades.title).toBe('Grades, six checks');
    expect(v.grades.sub).toBe(
      '24 Oct the first audit, 26–29 Oct run by you, weekly from Fri 30 Oct around 06:00',
    );
    const [seo, ai] = v.grades.cards;
    expect(seo).toMatchObject({ letter: 'B', score: 79, move: '−1 since Thu' });
    expect(seo!.parts).toBe('Structure 74 · Orphans 7 · Depth 2.4');
    expect(ai).toMatchObject({ letter: 'F', score: 22, move: '−19 since Thu' });
    // blocked: Claude-SearchBot and ClaudeBot by robots.txt, GPTBot by a rule = 3 of the 6 AI crawlers.
    expect(ai!.parts).toBe('Crawlers blocked 3 of 6 · Text without JS 31% · Quotable 58');
  });

  it('lays the eight crawlers out by check, with the cause now', () => {
    expect(v.crawlers.columns).toEqual(['24 Oct', '26', '27', '28', 'Thu 29', 'Fri 30']);
    expect(v.crawlers.rows.map((r) => r.ua)).toEqual([
      'Googlebot',
      'Bingbot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'Claude-SearchBot',
      'GPTBot',
      'ClaudeBot',
    ]);
    const by = (ua: string) => v.crawlers.rows.find((r) => r.ua === ua)!;
    expect(by('Googlebot').cause).toBe('allowed by robots.txt; verified bot, not fetched');
    expect(by('GPTBot').cause).toBe('Cloudflare firewall rule (error 1020)');
    expect(by('OAI-SearchBot').cause).toBe('client-rendered template, 31%');
    expect(by('ClaudeBot').cause).toBe('robots.txt changed Thu 19:40: ClaudeBot disallowed');
    expect(by('ClaudeBot').changedNow).toBe(true);
    expect(by('GPTBot').changedNow).toBe(false);
  });

  it('lists the fixes by number, marks the new ones and the Pro ones, and groups the rest', () => {
    expect(v.fixes.title).toBe('Fixes · 16, counting the 3 new');
    expect(v.fixes.rows.map((r) => [r.number, r.isNew, r.pro, r.effect])).toEqual([
      [0, true, false, '+19 AI'],
      [1, false, false, '+24 AI'],
      [2, false, false, '+22 AI'],
      [3, false, true, '+4 SEO'],
      [4, false, true, 'AI after fixes 1 and 2'],
    ]);
    expect(v.fixes.rows[0]!.diff).toBe(
      'robots.txt, Thu 19:40 · + User-agent: ClaudeBot · + User-agent: Claude-SearchBot · + Disallow: / · three lines to delete, then mark done',
    );
    expect(v.fixes.rows[2]!.note).toBe(
      'marked done Wed; the re-check that day did not agree, so it stays open',
    );
    expect(v.fixes.rest).toMatchObject({ numbers: '5–15', count: 11 });
    expect(v.fixes.rest!.title).toBe('Eleven more: 7 in Structure and 4 in Content');
  });

  it('shows the site’s settings and the alert rules that fired at its checks', () => {
    expect(v.settings.rows.map((r) => [r.label, r.value])).toEqual([
      ['Schedule', 'weekly, Fri around 06:00, America/Indiana/Indianapolis'],
      ['Page cap', '2,000 on Pro · 214 crawled'],
      ['Competitor', 'summitgear.co'],
      ['Staging', 'staging.example-outfitter.dev · on each deploy'],
      ['Public link', 'crawlmouse.com/r/example-outfitter-25oct'],
      ['Remove this site', 'Its history stays in your account in case you add it back'],
    ]);
    expect(v.alerts.rows.map((r) => [r.on, r.fired])).toEqual([
      [true, 'fired Fri 06:03'],
      [true, null],
      [true, 'fired Fri 06:03'],
      [true, null],
      [true, null],
      [false, null],
    ]);
    expect(v.alerts.foot).toBe(
      'Sent to you@company.com and #seo in Slack, once per check, only when something fires.',
    );
  });
});

describe('Site: a rule the site overrides (CC-28 D8)', () => {
  it('shows the site’s own row of a kind in place of the account’s, once, and switches that one', () => {
    const d = structuredClone(bad);
    const anyChange = d.alert_rules.find((r) => r.site_id === null && r.kind === 'any_change')!;
    const override = {
      ...anyChange,
      id: 'a1e40000-0000-4000-8000-000000000001',
      site_id: OUTFITTER,
      enabled: true,
    };
    d.alert_rules.push(override);
    const v = siteView(d, { accountId: BAD_ACCOUNT, now: bad.as_of }, OUTFITTER);
    expect(v.alerts.rows).toHaveLength(6);
    const row = v.alerts.rows.at(-1)!;
    expect([row.key, row.on]).toEqual([override.id, true]);
    expect(row.toggle.href).toBe(`/api/sites/${OUTFITTER}/alert-rules`);
    expect(row.toggle.fields).toEqual({ _method: 'PUT', rule: 'any_change', enabled: 'false' });
  });
});

describe('Site, withheld: granitepeak.example as Northwind Digital', () => {
  const c = fixture('challenged-site');
  const v = siteView(c, { accountId: C9, now: c.as_of }, GRANITEPEAK);

  it('withholds the AI grade and says why, and keeps the Technical SEO grade', () => {
    const [seo, ai] = v.grades.cards;
    expect(seo).toMatchObject({ letter: 'C+', score: 66 });
    expect(ai!.letter).toBeNull();
    expect(ai!.withheld).toMatch(/scored crawlers could be measured/);
  });

  it('draws only the checks that have a result, and names the ones that did not', () => {
    expect(v.crawlers.columns).toHaveLength(2);
    expect(v.header.line).toContain('latest check failed');
  });
});

describe('the history axis across a change of month', () => {
  it('gives the new month its name, and the weekday only to labels without one', () => {
    const at = (ts: string) => ({ finished_at: ts }) as Parameters<typeof axisLabels>[0][number];
    const checks = ['2026-10-30T15:00:00Z', '2026-10-31T15:00:00Z', '2026-11-01T15:00:00Z'].map(at);
    // Fri 30 Oct, Sat 31 Oct, Sun 1 Nov in Indiana.
    expect(axisLabels(checks, 'America/Indiana/Indianapolis')).toEqual([
      '30 Oct',
      'Sat 31',
      '1 Nov',
    ]);
  });
});
