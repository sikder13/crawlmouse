/**
 * The dashboard's view model against values worked out by hand from the fixtures (the comments give
 * the arithmetic), so a test cannot pass by agreeing with the code it checks.
 */
import { describe, expect, it } from 'vitest';
import { DASHBOARD_COPY } from '../copy/dashboard';
import { fixture } from '../fixtures';
import { firstRunNow } from './account';
import { CAPABILITIES } from './agencies';
import {
  ACCOUNT_ACTIONS,
  dashboardView,
  moveOver,
  weekdayAmbiguous,
  type DashboardView,
  withoutTrialOffer,
} from './dashboard';
import {
  CLEAN_VIEWER,
  dashboardPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const C9 = 'a0000000-0000-4000-8000-0000000000c9';
const bad = fixture('bad-site');

const home = () => dashboardView(bad, { accountId: BAD_ACCOUNT, now: bad.as_of });
const day0 = () =>
  dashboardView(bad, { accountId: BAD_ACCOUNT, now: firstRunNow(bad, { accountId: BAD_ACCOUNT }) });

/** headline = rows = cells, the reconciliation D5 asks for. */
function reconciles(v: DashboardView) {
  const cells = v.sites.rows.reduce((n, r) => n + r.since.opened + r.since.resolved, 0);
  expect(cells).toBe(v.changed.length);
  if (v.strip) expect(v.strip.opened.count + v.strip.resolved.count).toBe(v.changed.length);
  expect(v.shell.nav.find((n) => n.label === 'Changes')!.count).toBe(
    v.changed.length ? `${v.changed.length} new` : null,
  );
}

describe('Dashboard home, bad-site at as_of (Fri 30 Oct 06:05 in Indiana)', () => {
  const v = home();

  it('names Thursday’s check and the account’s day in its zone', () => {
    expect(v.firstRun).toBe(false);
    expect(v.header.title).toBe("Since Thursday's check");
    // last check: 10:02Z = 06:02 EDT; next: Fri 6 Nov 06:00 EST; trial: 8 Nov 02:41Z = Sat 7 Nov.
    expect(v.header.line).toBe(
      'Fri 30 Oct · 4 sites · last check today 06:02 · next weekly check Fri 6 Nov around 06:00 · trial ends Sat 7 Nov',
    );
  });

  it('means both grades over the four sites that hold a slot, 569 / 8 = 71, and moves over the three with a previous result', () => {
    // The staging copy holds no slot (F-097), so it is neither averaged nor counted (it read 74 with it).
    // now: 79+22 · 84+93 · 74+78 · 73+66 = 569 / 8 = 71.125 → 71.
    // The move leaves out redbirdaviation.com (74+78 at both), on a new baseline since Thursday:
    // Thursday 80+41 · 79+93 · 73+66 = 432 / 6 = 72; now 79+22 · 84+93 · 73+66 = 417 / 6 = 69.5 → 70.
    expect(v.strip!.health.value).toBe('71');
    expect(v.strip!.health.delta).toBe('−2 since Thu');
    expect(v.strip!.health.fresh).toBe('1 new');
    expect(v.strip!.health.excluded).toBeNull();
  });

  it('counts change records per site window: two opened, one resolved, three other', () => {
    // site 1: changes 1, 2 opened, 3, 4 changed; site 2: 5 resolved; site 3: 8 baseline.
    expect(v.strip!.opened).toMatchObject({ count: 2, noun: 'crawlers blocked' });
    expect(v.strip!.resolved).toMatchObject({ count: 1, noun: 'change: orphan pages' });
    expect(v.strip!.other.count).toBe(3);
    expect(v.changed.map((c) => c.title)).toEqual([
      'Claude-SearchBot is now blocked on example-outfitter.com',
      'ClaudeBot is now blocked on example-outfitter.com',
      'nahltech.com: 3 orphan pages now linked',
    ]);
    reconciles(v);
  });

  it('writes each change’s line from its own fields and its check’s grade moves (Q12)', () => {
    expect(v.changed[0]!.line).toBe(
      'Detected Fri 06:02 · robots.txt changed Thu 19:40 · 214 pages · this check: AI readability D → F · sent to Slack #seo',
    );
    expect(v.changed[2]!.line).toBe('Fri 06:01 · Technical SEO B → B+ · from your fix list');
    // Fix 0 is open, so its change offers it; ClaudeBot's change has no fix; fix 20 is resolved.
    expect(v.changed.map((c) => c.actions.map((a) => a.label))).toEqual([
      ['Diff', 'Copy fix', 'Email to my developer'],
      ['Diff'],
      ['Diff'],
    ]);
  });

  it('lists the sites with their result checks, and counts primary sites against the limit (Q10)', () => {
    expect(
      v.sites.rows.map((r) => [r.host, r.seo?.letter, r.seo?.score, r.ai?.letter, r.ai?.score]),
    ).toEqual([
      ['example-outfitter.com', 'B', 79, 'F', 22],
      ['nahltech.com', 'B+', 84, 'A', 93],
      ['redbirdaviation.com', 'B-', 74, 'B', 78],
      ['drivepei.ca', 'B-', 73, 'C', 66],
      ['staging.example-outfitter.dev', 'A-', 86, 'A-', 88],
    ]);
    expect(v.sites.rows.map((r) => r.lastCheck)).toEqual([
      'Fri 06:02',
      'Fri 06:01',
      'Fri 06:01',
      'Fri 06:01 · check queued',
      'Thu 18:23',
    ]);
    expect(v.sites.rows.map((r) => r.schedule)).toEqual([
      'weekly, Fri',
      'weekly, Fri',
      'weekly, Fri',
      'weekly, Fri',
      'on each deploy',
    ]);
    expect(v.sites.note).toBe('4 of 5 on Pro');
    expect(v.sites.upsell).toBeNull();
  });

  it('draws the primary site’s six checks in the account’s dates', () => {
    const h = v.history!;
    expect(h.title).toBe('example-outfitter.com · 6 checks since 24 Oct, 4 of them run by you');
    expect(h.points.map((p) => p.label)).toEqual(['24 Oct', '26', '27', '28', 'Thu 29', 'Fri 30']);
    expect(h.points.map((p) => p.seo)).toEqual([79, 79, 80, 80, 80, 79]);
    expect(h.points.map((p) => p.ai)).toEqual([41, 41, 41, 41, 41, 22]);
    // AI readability is 41 at the first five checks; at the sixth, robots.txt blocked two crawlers.
    expect(h.flatNote).toBe('AI readability · 41 since the first audit');
    expect(h.marker).toEqual({
      index: 5,
      label: 'Claude-SearchBot and ClaudeBot blocked · 22',
      verdicts: ['disallowed_by_robots', 'disallowed_by_robots'],
    });
    expect(h.summary).toBe(
      'Technical SEO 79 at checks 1 to 2, then 80 at checks 3 to 5, then 79 at check 6; AI readability 41 at checks 1 to 5, then 22 at check 6',
    );
  });

  it('shows crawler access by check for the six AI crawlers, and now for all eight', () => {
    expect(v.crawlersByCheck!.map((r) => r.ua)).toEqual([
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'Claude-SearchBot',
      'GPTBot',
      'ClaudeBot',
    ]);
    const claude = v.crawlersByCheck!.find((r) => r.ua === 'ClaudeBot')!;
    expect(claude.verdicts).toEqual([
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'disallowed_by_robots',
    ]);
    expect(v.crawlersNow!.map((r) => r.ua)).toHaveLength(8);
  });

  it('lists what is left to set up from the Pro gates and what is built: none of one (FACTS l.57, D-16)', () => {
    expect(v.setup!.title).toBe('Everything is set up');
    expect(v.setup!.items.map((i) => i.done)).toEqual([true]);
  });

  it('offers nothing to connect that has no connection behind it (CTO ruling 047)', () => {
    const text = JSON.stringify(v.setup);
    expect(text).not.toContain('Search Console');
    expect(text).not.toContain('Vercel Drain');
  });

  it('carries the trial card that follows the first run', () => {
    // Fri 30 Oct to Sat 7 Nov in Indiana: eight dates (Q4).
    expect(v.shell.trial).toMatchObject({
      title: 'Pro, trial · ends Sat 7 Nov',
      left: '8 days left',
      billing: null,
    });
    expect(v.shell.trial!.keep!.label).toBe('Keep Pro, $19 a month');
    expect(v.shell.nav.find((n) => n.label === 'Sites')!.count).toBe('4');
  });

  it('makes running a check its one orange action', () => {
    expect(v.header.actions.filter((a) => a.primary).map((a) => a.label)).toEqual([
      'Run a check now',
    ]);
  });
});

describe('V2R dashboard fixes: what the dashboard reads (QA dashboard walk, 24 Nov)', () => {
  const v = home();
  const OUTFITTER_LATEST = 'c0000000-0000-4000-8000-000000000006';
  const NAHLTECH_LATEST = 'c0000000-0000-4000-8000-00000000000c';

  it('(e) says beside "4 of 5" which of the five rows holds no slot, counted from the records', () => {
    // Five rows; staging.example-outfitter.dev is the staging copy of example-outfitter.com.
    expect(v.sites.rows).toHaveLength(5);
    expect(v.sites.note).toBe('4 of 5 on Pro');
    expect(v.sites.apart).toBe('1 staging copy holds no slot');
  });

  it('(l) counts the same four sites in the rail, the header line, the add-site button and the card', () => {
    // The 1280 and 390-dark baselines drew "Sites 5" and "5 sites" from before F-097.
    expect(v.shell.nav.find((n) => n.label === 'Sites')!.count).toBe('4');
    expect(v.header.line).toContain(' · 4 sites · ');
    expect(v.header.actions.map((a) => a.label)).toContain('Add a site · 4 of 5 on Pro');
  });

  it('D-05: "last check" is the newest result of any site, not the first site’s', () => {
    const copy = structuredClone(bad);
    // nahltech.com's latest result moved to 10:04Z (06:04 in Indiana), after the first site's 06:02.
    copy.checks.find((c) => c.id === NAHLTECH_LATEST)!.finished_at = '2026-10-30T10:04:00Z';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.header.line).toContain('last check today 06:04');
  });

  it('D-07: a partial result says "partial" beside its time in the sites table', () => {
    const copy = structuredClone(bad);
    copy.checks.find((c) => c.id === OUTFITTER_LATEST)!.status = 'partial';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.sites.rows.map((r) => r.lastCheck)).toEqual([
      'Fri 06:02 · partial',
      'Fri 06:01',
      'Fri 06:01',
      'Fri 06:01 · check queued',
      'Thu 18:23',
    ]);
  });

  it('D-09: an AI crawler blocked on a site the panels do not read is listed, with its site', () => {
    expect(v.crawlersSite).toBe('example-outfitter.com');
    expect(v.blockedElsewhere).toEqual([]);
    const copy = structuredClone(bad);
    const c = copy.checks.find((x) => x.id === NAHLTECH_LATEST)!;
    c.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'disallowed_by_robots';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.blockedTitle).toBe('AI crawlers blocked on your other sites');
    expect(w.blockedElsewhere.map((b) => [b.host, b.ua, b.verdict])).toEqual([
      ['nahltech.com', 'GPTBot', 'disallowed_by_robots'],
    ]);
  });

  it('D-10: with no site carrying both grades, the tile shows the Technical SEO mean, named as that', () => {
    expect(v.strip!.health.seoOnly).toBeNull();
    const copy = structuredClone(bad);
    const latestIds = [
      OUTFITTER_LATEST,
      NAHLTECH_LATEST,
      'c0000000-0000-4000-8000-000000000016',
      'c0000000-0000-4000-8000-000000000020',
      'c0000000-0000-4000-8000-00000000002a',
    ];
    for (const id of latestIds) {
      const ai = copy.checks.find((x) => x.id === id)!.ai_readability!;
      ai.withheld = true;
      ai.withheld_reasons = ['readable_unmeasured'];
    }
    const h = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of }).strip!.health;
    expect(h.value).toBe('—');
    // The four sites that hold a slot, the staging copy left out (B1, F-097).
    expect(h.excluded).toBe('AI readability withheld on 4 sites');
    // 79 + 84 + 74 + 73 = 310 / 4 = 77.5 → 78.
    expect(h.seoOnly).toEqual({
      label: 'Technical SEO, mean of 4 sites · no site has both grades',
      value: '78',
    });
  });

  it('D-06: the set-up title counts the rows it lists as left; the schedule is not one of them', () => {
    for (const w of [v, day0()]) {
      const s = w.setup!;
      expect(s.items.map((i) => i.key)).not.toContain('schedule');
      if (!w.firstRun) {
        expect(s.title).toBe(DASHBOARD_COPY.setupLeftTitle(s.items.filter((i) => !i.done).length));
      }
    }
    expect(v.setup!.title).toBe('Everything is set up');
    expect(v.setup!.schedule!.label).toBe(
      'Choose the day and hour example-outfitter.com is checked weekly (now Fri around 06:00)',
    );
  });

  it('D-16: offers only built, shown set-up items whose control has a page', () => {
    // Slack (built, its Connect page served) is done; competitors and staging are "coming"
    // (CAPABILITIES); Search Console and observed visits are not offered at all (CTO ruling 047).
    expect(v.setup!.items.map((i) => [i.key, i.label, i.done])).toEqual([
      ['slack', 'Slack alerts connected', true],
    ]);
    expect(day0().setup!.items.map((i) => i.key)).toEqual(['slack']);
    expect(day0().setup!.foot).toBe(
      'It stops when the 14 days end unless you keep Pro. The site, its audits and its monthly check do not.',
    );
  });

  it('D-16, M5: the trial offer names Slack, whose Connect page is served (#167), and no competitor', () => {
    expect(dashboardPreview('clean').startPro!.body).toBe(
      'Weekly checks, every fix with its packet and Slack alerts, on up to 5 sites, for 14 days. No card. When it ends, this account goes back to Free; nothing you can see is deleted.',
    );
  });

  it('M1: Slack not connected is the one thing left; with no row listed, the card claims nothing done', () => {
    const copy = structuredClone(bad);
    for (const a of copy.accounts) {
      a.integrations = a.integrations.map((i) => ({ ...i, connected: false }));
    }
    const left = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of }).setup!;
    expect(left.title).toBe('One thing left to set up');
    expect(left.items.map((i) => [i.key, i.done])).toEqual([['slack', false]]);
    // With Slack not offered (as when its capability is not built), no row is listed.
    const slack = CAPABILITIES.slack_alerts as { status: string };
    slack.status = 'coming';
    try {
      const s = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of }).setup!;
      expect(s.items).toEqual([]);
      expect(s.title).toBe('Weekly check schedule');
      expect(s.schedule!.label).toBe(
        'Choose the day and hour example-outfitter.com is checked weekly (now Fri around 06:00)',
      );
    } finally {
      slack.status = 'built';
    }
  });

  it('says each reason on its own terms beside the Technical SEO mean (review 2)', () => {
    const copy = structuredClone(bad);
    // Three primary sites withheld; drivepei.ca has no result (its checks failed).
    for (const id of ['000000000006', '00000000000c', '000000000016']) {
      const ai = copy.checks.find((x) => x.id === `c0000000-0000-4000-8000-${id}`)!.ai_readability!;
      ai.withheld = true;
      ai.withheld_reasons = ['readable_unmeasured'];
    }
    for (const c of copy.checks) {
      if (c.site_id === '50000000-0000-4000-8000-000000000004') c.status = 'failed';
    }
    const h = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of }).strip!.health;
    // 79 + 84 + 74 = 237 / 3 = 79.
    expect(h.seoOnly).toEqual({
      label: 'Technical SEO, mean of 3 sites · no site has both grades',
      value: '79',
    });
    expect(h.excluded).toBe('AI readability withheld on 3 sites; no finished check yet on 1 site');
  });

  it('names "since" from a site that holds a slot, never the staging copy (review 3)', () => {
    const copy = structuredClone(bad);
    // The first site has one result, so "since" falls back to the others' previous results:
    // drivepei.ca's Mon 26 Oct 19:11Z, not the staging copy's later Tue 27 Oct 18:13Z.
    for (const id of [2, 3, 4, 5, 6]) {
      copy.checks.find((c) => c.id === `c0000000-0000-4000-8000-00000000000${id}`)!.status =
        'failed';
    }
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.header.title).toBe("Since Monday's check");
  });

  it('F2: an account whose only results are a staging copy’s is on its first run, and does not throw', () => {
    const copy = structuredClone(bad);
    // Every check of the four primary sites failed; the staging copy keeps its two results.
    const staging = new Set(
      copy.sites.filter((s) => s.staging_of_site_id !== null).map((s) => s.id),
    );
    for (const c of copy.checks) if (!staging.has(c.site_id)) c.status = 'failed';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.firstRun).toBe(true);
    // No primary result: no "audited" and no "last check"; the first site's schedule and the trial.
    expect(w.header.line).toBe(
      'Fri 30 Oct · 4 sites · next weekly check Fri 6 Nov around 06:00 · trial ends Sat 7 Nov',
    );
  });

  it('(8) day 0 with every listed row done says so, not "Worth doing while Pro is on"', () => {
    expect(day0().setup!.items.map((i) => i.done)).toEqual([true]);
    expect(day0().setup!.title).toBe('Everything is set up');
  });

  it('M4: a staging copy’s check is never the "last check"', () => {
    const copy = structuredClone(bad);
    // staging.example-outfitter.dev's latest moved to 10:04Z (06:04), after every primary site's.
    copy.checks.find((c) => c.id === 'c0000000-0000-4000-8000-00000000002a')!.finished_at =
      '2026-10-30T10:04:00Z';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.header.line).toContain('last check today 06:02');
  });

  it('M2: a first site with one result lists its own blocks, since no panel is drawn', () => {
    const copy = structuredClone(bad);
    // Only the first audit stays a result; the later five checks of example-outfitter.com failed.
    for (const id of [2, 3, 4, 5, 6]) {
      copy.checks.find((c) => c.id === `c0000000-0000-4000-8000-00000000000${id}`)!.status =
        'failed';
    }
    copy.checks
      .find((c) => c.id === 'c0000000-0000-4000-8000-000000000001')!
      .crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'disallowed_by_robots';
    const w = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of });
    expect(w.history).toBeNull();
    expect(w.crawlersSite).toBeNull();
    expect(w.blockedTitle).toBe('AI crawlers blocked on your sites');
    expect(w.blockedElsewhere.map((b) => [b.host, b.ua])).toEqual([
      ['example-outfitter.com', 'GPTBot'],
    ]);
  });

  it('D-15: the schedule link opens the first site’s settings card by its anchor', () => {
    expect(v.setup!.schedule!.action!.href).toBe(
      '/sites/50000000-0000-4000-8000-000000000001#settings',
    );
  });
});

describe('Dashboard, day 0: the moment the account begins', () => {
  const v = day0();

  it('is the first run: one site, one audit, nothing to compare', () => {
    expect(v.firstRun).toBe(true);
    expect(v.strip).toBeNull();
    expect(v.changed).toEqual([]);
    expect(v.header.title).toBe('example-outfitter.com is kept.');
    expect(v.header.line).toBe(
      'Sat 24 Oct · 1 site · audited today 22:34 · next weekly check Fri 30 Oct around 06:00 · trial ends Sat 7 Nov',
    );
    expect(v.sites.rows.map((r) => r.sinceLabel)).toEqual(['first audit · 13 fixes']);
    reconciles(v);
  });

  it('starts with the three largest fixes, and says how many more there are', () => {
    expect(v.topFixes!.rows.map((r) => [r.number, r.effect])).toEqual([
      [1, '+24 AI'],
      [2, '+22 AI'],
      [3, '+4 SEO'],
    ]);
    expect(v.topFixes!.foot).toBe(
      'Each fix page has "Mark done and re-check now", about 2 minutes. The other 10 are open for 14 days.',
    );
    expect(v.header.actions.filter((a) => a.primary).map((a) => a.label)).toEqual([
      'Start with fix 1 · about 10 minutes',
    ]);
  });

  it('dates the reminder three days before the trial ends, in the account’s zone (A8, Q4)', () => {
    // 8 Nov 02:41Z − 3 days = 5 Nov 02:41Z = Wed 4 Nov 21:41 EST.
    expect(v.threeKinds!.body).toContain(
      'one reminder on Wed 4 Nov, three days before the trial ends.',
    );
    expect(v.shell.trial).toMatchObject({ left: '14 days left', keep: null });
    expect(v.shell.trial!.billing).not.toBeNull();
  });
});

describe('Dashboard, withheld: challenged-site as Northwind Digital (past_due, Agency in grace)', () => {
  const c = fixture('challenged-site');
  const v = dashboardView(c, { accountId: C9, now: c.as_of });

  it('means harborlight’s two grades, (91 + 89) / 2 = 90, and names the site it left out', () => {
    expect(v.strip!.health.value).toBe('90');
    expect(v.strip!.health.excluded).toBe('1 site excluded: AI readability withheld');
    // An Agency account's rail is the agency rail (CC-31): its sites are counted under Clients.
    expect(v.shell.nav.find((n) => n.label === 'Sites')).toBeUndefined();
    expect(v.shell.nav.find((n) => n.label === 'Clients')).toMatchObject({
      count: '2',
      current: true,
    });
    expect(v.shell.trial).toBeNull();
    expect(v.sites.note).toBe('2 of 25 on Agency');
    reconciles(v);
  });
});

describe('Dashboard home when the sites graded then and now differ (bad-site, Mon 26 Oct 19:02Z)', () => {
  const v = dashboardView(bad, { accountId: BAD_ACCOUNT, now: '2026-10-26T19:02:00Z' });

  it('means the four grades now, and moves over the one site with a previous result, nahltech.com new', () => {
    // now: example-outfitter.com 79 + 41 (check 2), nahltech.com 79 + 93 (its first audit): 292 / 4 = 73.
    // then, its previous check (Sat 24 Oct; read from the account's start, 02:41Z): only
    // example-outfitter.com, 79 + 41 = 60, and 60 now: no change. nahltech.com had no result then:
    // it is on its first baseline, out of the move, and said beside it.
    expect(v.strip!.health.value).toBe('73');
    expect(v.strip!.health.delta).toBe('no change since Sat');
    expect(v.strip!.health.fresh).toBe('1 new');
    expect(v.header.title).toBe("Since Saturday's check");
  });
});

describe('Dashboard, withheld: a previous check a week or more back is named by its date', () => {
  const c = fixture('challenged-site');
  const v = dashboardView(c, { accountId: C9, now: c.as_of });

  it('names Fri 23 Oct, not "Friday", which the latest check also is', () => {
    // harborlight.example (created 23 Oct, the oldest) is the primary site; its previous result
    // finished Fri 23 Oct, ten days before Mon 2 Nov, and its latest Fri 30 Oct.
    expect(v.header.title).toBe('Since the check of Fri 23 Oct');
    expect(v.strip!.health.delta).toBe('no change since Fri 23 Oct');
  });
});

describe('Dashboard, clean: an unkept audit adopted by a free account that never had a trial', () => {
  const c = fixture('clean-site');
  const v = dashboardView(c, CLEAN_VIEWER);

  it('offers 14 days of Pro once (H5), and nothing that Pro alone would set up', () => {
    expect(v.startPro).not.toBeNull();
    expect(v.setup).toBeNull();
    expect(v.shell.trial).toBeNull();
    expect(v.sites.note).toBe('1 of 1 on Free');
    reconciles(v);
  });
});

describe('the actions CC-26b wires', () => {
  it('names a route for every action the screens offer', () => {
    for (const v of [home(), day0()]) {
      const actions = [
        ...v.header.actions,
        ...v.changed.flatMap((c) => c.actions),
        ...(v.setup?.items.flatMap((i) => (i.action ? [i.action] : [])) ?? []),
      ];
      const known = new Set(Object.values(ACCOUNT_ACTIONS).map((a) => a.route));
      for (const a of actions) expect(known).toContain(a.route);
    }
  });
});

describe('The health move compares only the sites graded at both moments', () => {
  // Worked by hand: no fixture holds a moment where a site graded then is not graded now.
  it('leaves out a site graded then but not now', () => {
    const then = new Map<string, [number, number]>([
      ['x', [80, 80]],
      ['y', [20, 20]],
    ]);
    const now = new Map<string, [number, number]>([['x', [90, 90]]]);
    // Over every site graded then, the earlier mean would be 50.
    expect(moveOver(then, now)).toEqual({ both: ['x'], a: 80, b: 90 });
  });

  it('leaves out a site graded now but not then', () => {
    const then = new Map<string, [number, number]>([['x', [70, 70]]]);
    const now = new Map<string, [number, number]>([
      ['x', [80, 80]],
      ['z', [0, 0]],
    ]);
    // Over every site graded now, the later mean would be 40.
    expect(moveOver(then, now)).toEqual({ both: ['x'], a: 70, b: 80 });
  });
});

describe('“Since” names a check by its date when a weekday could mean another', () => {
  const IND = 'America/Indiana/Indianapolis';
  const NOW = '2026-10-30T12:00:00Z'; // Fri 30 Oct, 08:00 in Indiana

  it('a week or more back, by its date, whatever the newest result’s weekday', () => {
    expect(weekdayAmbiguous('2026-10-22T12:00:00Z', null, NOW, IND)).toBe(true); // Thu, 8 days
    expect(weekdayAmbiguous('2026-10-23T12:00:00Z', null, NOW, IND)).toBe(true); // Fri, 7 days
    expect(weekdayAmbiguous('2026-10-22T12:00:00Z', '2026-10-29T12:00:00Z', NOW, IND)).toBe(true);
  });

  it('under a week back, by its date only when the newest result fell on the same weekday', () => {
    expect(weekdayAmbiguous('2026-10-24T12:00:00Z', null, NOW, IND)).toBe(false); // Sat, 6 days
    expect(weekdayAmbiguous('2026-10-26T12:00:00Z', '2026-10-29T12:00:00Z', NOW, IND)).toBe(false);
    expect(weekdayAmbiguous('2026-10-29T12:00:00Z', '2026-10-29T20:00:00Z', NOW, IND)).toBe(true);
  });
});

describe('The first-run note follows the site’s schedule', () => {
  it('on the clean dashboard, whose site has none, says only that it will be checked again', () => {
    expect(dashboardView(fixture('clean-site'), CLEAN_VIEWER).sites.foot).toBe(
      'Changes appear here once the site is checked again. Nothing to compare yet.',
    );
  });
});

describe('Change notes name one sender', () => {
  it('the day-0 sentence names CC-25’s ALERTS_SENDER, and the dashboard copy keeps no second one', async () => {
    const { ALERTS_SENDER } = await import('../../auth/constants');
    expect(day0().threeKinds!.body).toContain(
      `a note from ${ALERTS_SENDER} when a check finds a change`,
    );
    expect(Object.keys(await import('../copy/dashboard'))).not.toContain('ALERTS_FROM');
  });
});

describe('Who builds each account route', () => {
  it('the account pages CC-27 previews are wired by the steps the owner named', () => {
    const cc27b = Object.entries(ACCOUNT_ACTIONS)
      .filter(([, a]) => a.owner === 'CC-27b')
      .map(([key]) => key)
      .sort();
    // CC-27b D10 moved `reports` to the agency workspace's step, which built it (app/api/reports);
    // owner ruling Q15 gave the change log and the per-site rules to CC-28, which built them
    // (app/changes/page.tsx, app/api/sites/[id]/alert-rules), and Integrations a later page of its own.
    expect(cc27b).toEqual(['emailSettings', 'plan']);
    expect(ACCOUNT_ACTIONS.reports.owner).toBe('built');
    expect([ACCOUNT_ACTIONS.changeLog.owner, ACCOUNT_ACTIONS.alertRules.owner]).toEqual([
      'built',
      'built',
    ]);
    expect(ACCOUNT_ACTIONS.integrations.owner).toBe('built');
    expect(new Set(Object.values(ACCOUNT_ACTIONS).map((a) => a.owner))).toEqual(
      new Set(['CC-26b', 'CC-27b', 'built']),
    );
  });
});

describe('A site on its first baseline is left out of the health move (owner ruling 2026-11-08)', () => {
  // A copy of bad-site in which redbirdaviation.com's re-graded check (the new baseline, Fri 30 Oct)
  // scores 100 and 100. Worked by hand, earlier moment Thu 29 Oct 12:42Z:
  // The staging copy holds no slot, so it is in neither mean (F-097).
  //   the three other sites: Thursday 80+41 · 79+93 · 73+66 = 432 / 6 = 72;
  //                          now      79+22 · 84+93 · 73+66 = 417 / 6 = 69.5 → 70: −2.
  //   counting redbird too:  Thursday 432 + 74+78 = 584 / 8 = 73;
  //                          now      417 + 100+100 = 617 / 8 = 77.125 → 77: +4, the other sign.
  const copy = structuredClone(bad);
  const rebased = copy.checks.find((c) => c.id === 'c0000000-0000-4000-8000-000000000016')!;
  rebased.technical_seo!.score = 100;
  rebased.ai_readability!.total = 100;
  const h = dashboardView(copy, { accountId: BAD_ACCOUNT, now: bad.as_of }).strip!.health;

  it('keeps the move at −2 where counting the new site would make it +3', () => {
    expect(h.delta).toBe('−2 since Thu');
    expect(h.fresh).toBe('1 new');
  });

  it('still means every graded primary site in the value: 617 / 8 = 77', () => {
    expect(h.value).toBe('77');
  });
});

describe('the dashboard’s words about the account now', () => {
  it('names the one site an account keeps (F-118)', () => {
    expect(DASHBOARD_COPY.kept(['example-outfitter.com'])).toBe('example-outfitter.com is kept.');
  });

  it('with several, the heading is about the account, not its first site (F-118)', () => {
    expect(DASHBOARD_COPY.kept(['a.example', 'b.example'])).toBe('Two sites are kept.');
    expect(DASHBOARD_COPY.kept(['a', 'b', 'c', 'd', 'e'].map((h) => `${h}.example`))).toBe(
      'Five sites are kept.',
    );
  });

  it('says nothing of “the other 0” when no fix is left over (F-120)', () => {
    const none = DASHBOARD_COPY.topFixesFoot(0, 'on Pro');
    expect(none).toMatch(/^Each fix page has "Mark done and re-check now", about \d+ minutes\.$/);
    expect(none).not.toContain('other');
  });

  it('still says how many are left when some are (F-120)', () => {
    expect(DASHBOARD_COPY.topFixesFoot(1, 'on Pro')).toContain('The other 1 is on Pro.');
    expect(DASHBOARD_COPY.topFixesFoot(10, 'on Pro')).toContain('The other 10 are on Pro.');
  });
});

describe('the Pro trial offer after a refusal (F-104)', () => {
  const offered = () => {
    const d = fixture('clean-site');
    return dashboardView(d, CLEAN_VIEWER);
  };

  it('a refused trial is not offered again on the page that says why', () => {
    expect(offered().startPro).not.toBeNull();
    expect(withoutTrialOffer(offered(), { notice: 'refused' }).startPro).toBeNull();
  });

  it('any other notice, a repeated one, or none leaves the offer', () => {
    for (const q of [{}, { notice: 'capacity' }, { notice: ['refused', 'refused'] }]) {
      expect(withoutTrialOffer(offered(), q).startPro).not.toBeNull();
    }
  });

  it('changes nothing else on the page', () => {
    const v = offered();
    expect(withoutTrialOffer(v, { notice: 'refused' })).toEqual({ ...v, startPro: null });
  });
});

describe('a Free dashboard with paused sites, as after a trial ends (F-234, F-235)', () => {
  const c = fixture('clean-site');
  const site = c.sites.find((s) => CLEAN_VIEWER.adopt!.includes(s.id))!;
  const extra = ['b', 'c'].map((n) => ({
    ...site,
    id: `${site.id.slice(0, -1)}${n}`,
    host: `${n}.example`,
    paused: true,
  }));
  /** The clean account with two more sites, each paused; its own site paused when `all`. */
  const withPaused = (all: boolean) => ({
    ...c,
    sites: [...c.sites.map((s) => (s.id === site.id ? { ...s, paused: all } : s)), ...extra],
  });
  /** The clean viewer, adopting the two sites as well, on a plan of `sites` sites. */
  const viewer = (sites = 1) => ({
    ...CLEAN_VIEWER,
    adopt: [...CLEAN_VIEWER.adopt!, ...extra.map((s) => s.id)],
    account: { ...CLEAN_VIEWER.account!, limits: { ...CLEAN_VIEWER.account!.limits, sites } },
  });

  it('names the site Free still checks, and how many of the three are checked', () => {
    const v = dashboardView(withPaused(false), viewer());
    expect(v.header.title).toBe(`${site.host} is kept.`);
    // Three sites hold slots on a plan of one; one is checked.
    expect(v.sites.note).toBe('1 of 3 sites checked · Free checks 1 site');
  });

  it('with every site paused, says so, and promises no check', () => {
    const v = dashboardView(withPaused(true), viewer());
    expect(v.header.title).toBe('Every site is paused.');
    expect(v.sites.note).toBe('0 of 3 sites checked · Free checks 1 site');
    expect(v.sites.foot).toBe(
      'Every site is paused, so none is scheduled. Nothing to compare yet.',
    );
  });

  it('with the first site paused, names the schedule of a site still checked', () => {
    const d = withPaused(true);
    const b = d.sites.find((s) => s.id === extra[0]!.id)!;
    const weekly = {
      ...b,
      paused: false,
      schedule: { cadence: 'weekly' as const, iso_weekday: 5, hour_local: 6 },
    };
    const v = dashboardView(
      { ...d, sites: d.sites.map((s) => (s.id === b.id ? weekly : s)) },
      viewer(),
    );
    expect(v.header.title).toBe('b.example is kept.');
    expect(v.sites.foot).toBe(
      'Changes appear here after the first weekly check. Nothing to compare yet.',
    );
  });

  it('within the limit, keeps the slot count and adds how many are paused', () => {
    expect(dashboardView(withPaused(false), viewer(5)).sites.note).toBe(
      '3 of 5 on Free · 2 paused',
    );
  });
});
