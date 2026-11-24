/**
 * Goal 1 rule 2 on the plan cards of Home and on Sign-up's plan table and footer: "a stranger reads
 * only what works that day". Each phrase there that names a switched feature carries a capability
 * key, and `CAPABILITIES[key].risk` (lib/v2/view/agencies.ts) names the switch that hides it, as on
 * Pricing; the page limit follows `pages_2000` through Pricing's own `planPages`. While Agency is
 * not on sale (`billingPublic() && agencySalesOpen()` false), neither page names its trial or card.
 *
 * The literal pins below are the text at 735ac453. The plan section's markup is also pinned by
 * sha256: with `pages_2000` hidden and Agency open, it is byte for byte the markup 735ac453 rendered
 * with nothing hidden (the page limit is this change's one addition). Recompute a pin with
 *   git show 735ac453:<file> … render, then sha256 of `planSection(html)`.
 */
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../../../components/v2/screens/home/HomeScreen';
import homeStyles from '../../../components/v2/screens/home/HomeScreen.module.css';
import { SignupScreen } from '../../../components/v2/screens/signup/SignupScreen';
import signupStyles from '../../../components/v2/screens/signup/Signup.module.css';
import { homePreview } from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { GATES } from '../../entitlement-v2';
import type { RiskFeature } from '../../feature-switch';
import type { Features } from '../features';
import { count } from '../words';

vi.mock('server-only', () => ({}));
vi.mock('@/components/analytics/TrackView', () => ({ TrackView: () => null }));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));
const { RISK_FEATURES } = await import('../../feature-switch');

const EVERY = Object.fromEntries(RISK_FEATURES.map((f) => [f, true])) as Features;
const hide = (...names: RiskFeature[]): Features => ({
  ...EVERY,
  ...Object.fromEntries(names.map((n) => [n, false])),
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dom = (html: string) => new JSDOM(html).window.document;
const squish = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

interface CardText {
  name: string;
  body: string;
  action: string | null;
  note: string;
  links: string[];
}

/** Each plan card's name, body, button and note, read from the rendered markup. */
function cardsOf(html: string): CardText[] {
  return [...dom(html).querySelectorAll(`.${homeStyles.plan}`)].map((card) => {
    const kids = [...card.children];
    const button = card.querySelector(`.${homeStyles.planButton}`);
    const note = card.querySelector(`.${homeStyles.planNote}`);
    return {
      name: squish(kids[0]?.textContent),
      body: squish(card.querySelector(`.${homeStyles.planBody}`)?.textContent),
      action: button ? squish(button.textContent) : null,
      note: squish(note?.textContent),
      links: [...(note?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href') ?? ''),
    };
  });
}

/** The plan section's markup: from its heading's text to the end of the section. */
function planSection(html: string): string {
  const i = html.indexOf('Free to look');
  return html.slice(i, html.indexOf('</section>', i));
}

/** Sign-up's aside: from its kicker to the end of the card. */
function signupAside(html: string): string {
  const i = html.indexOf('What the account is');
  return html.slice(i, html.indexOf('</section>', i));
}

const homeHtml = (f: Features = EVERY, agencyOpen?: boolean) =>
  renderToStaticMarkup(<HomeScreen data={homePreview(f)} agencyOpen={agencyOpen} />);
const cards = (f?: Features, agencyOpen?: boolean) => cardsOf(homeHtml(f, agencyOpen));
const card = (name: string, f?: Features, agencyOpen?: boolean) =>
  cards(f, agencyOpen).find((c) => c.name === name)!;

const signupHtml = (f?: Features, agencyOpen?: boolean) =>
  renderToStaticMarkup(<SignupScreen checksPublic={false} features={f} agencyOpen={agencyOpen} />);
const tableRows = (html: string) =>
  [
    ...dom(html).querySelectorAll('table[aria-label="What your account includes"] td:first-child'),
  ].map((td) => squish(td.textContent));
const foot = (html: string) =>
  squish(dom(html).querySelector(`.${signupStyles.foot}`)?.textContent);

// ── The words at 735ac453 ──────────────────────────────────────────────────────────────────────

const LOCKED_HOME: CardText[] = [
  {
    name: 'Free',
    body: 'One site, checked monthly. The full crawler matrix, three complete fixes per audit, history kept.',
    action: 'Create a free account',
    note: 'Includes 14 days of Pro',
    links: [],
  },
  {
    name: 'Pro',
    body: 'Five sites, checked weekly. Every fix with a copy-paste packet, alerts to Slack, one competitor per site, PDF and CSV export.',
    action: 'Start with 14 days of Pro',
    note: 'The same free account; $19 a month only if you keep Pro',
    links: [],
  },
  {
    name: 'Agency',
    body: 'Twenty-five client sites, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.',
    action: 'Start a 14-day trial',
    note: 'Card required; nothing charged for 14 days',
    links: [],
  },
];
/** sha256 of `planSection` of HomeScreen's preview render at 735ac453. */
const LOCKED_HOME_SECTION_SHA = 'b69245f148ec511a6e884f28b0a46ebeafd5c29b2c4ba04430377c6bf8870725';

const LOCKED_SIGNUP_ROWS = [
  'One site, up to 500 pages, re-checked monthly',
  'An email only if a check finds a change',
  'Three complete fixes per audit, with packets',
  'Every audit, its evidence and link map, kept',
  'Every fix with copy-paste packets',
  'Weekly checks, alerts to Slack, up to 5 sites',
  'One competitor, PDF, CSV and JSON export, staging audits',
];
const LOCKED_SIGNUP_FOOT =
  'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites under your brand, $99 a month, 14-day trial with a card.';
/** sha256 of `signupAside` of SignupScreen (checks not public) at 735ac453. */
const LOCKED_SIGNUP_ASIDE_SHA = 'f475a71221259c84fc9d7df0e3b9305188f586d7b2e95ccbd40cd39e7e030ec3';

// ── With nothing hidden: the page limit added, every other word as it was ──────────────────────

const PRO_SHOWN =
  'Five sites, up to 2,000 pages a site, checked weekly. Every fix with a copy-paste packet, alerts to Slack, one competitor per site, PDF and CSV export.';
const AGENCY_SHOWN =
  'Twenty-five client sites, up to 2,000 pages a site, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.';
const SIGNUP_PRO_LIMITS_SHOWN =
  'Weekly checks, alerts to Slack, up to 5 sites, up to 2,000 pages a site';

const SHOWN_HOME = LOCKED_HOME.map((c) =>
  c.name === 'Pro'
    ? { ...c, body: PRO_SHOWN }
    : c.name === 'Agency'
      ? { ...c, body: AGENCY_SHOWN }
      : c,
);
const SHOWN_SIGNUP_ROWS = LOCKED_SIGNUP_ROWS.map((r) =>
  r === 'Weekly checks, alerts to Slack, up to 5 sites' ? SIGNUP_PRO_LIMITS_SHOWN : r,
);

describe('nothing hidden, Agency on sale', () => {
  it('Home: the cards read the words of 735ac453, with the paid plans’ page limit added', () => {
    expect(cards()).toEqual(SHOWN_HOME);
    expect(cards(EVERY, true)).toEqual(SHOWN_HOME);
  });

  it('Sign-up: the table and footer read the words of 735ac453, with Pro’s page limit added', () => {
    expect(tableRows(signupHtml())).toEqual(SHOWN_SIGNUP_ROWS);
    expect(foot(signupHtml())).toBe(LOCKED_SIGNUP_FOOT);
  });

  it('with pages_2000 hidden too, the plan section is byte for byte 735ac453’s', () => {
    expect(cards(hide('pages_2000'))).toEqual(LOCKED_HOME);
    expect(sha(planSection(homeHtml(hide('pages_2000'))))).toBe(LOCKED_HOME_SECTION_SHA);
    expect(tableRows(signupHtml(hide('pages_2000')))).toEqual(LOCKED_SIGNUP_ROWS);
    expect(foot(signupHtml(hide('pages_2000')))).toBe(LOCKED_SIGNUP_FOOT);
    expect(sha(signupAside(signupHtml(hide('pages_2000'))))).toBe(LOCKED_SIGNUP_ASIDE_SHA);
  });
});

/**
 * Per switch: the Pro body, the Agency body, Sign-up's rows and footer with that switch alone off.
 * A value equal to the nothing-hidden one is a surface that names nothing the switch hides.
 */
const PER_SWITCH: Record<
  'competitors' | 'staging_deploys' | 'agency_white_label' | 'agency_domain',
  { pro: string; agency: string; rows: string[]; foot: string }
> = {
  competitors: {
    pro: 'Five sites, up to 2,000 pages a site, checked weekly. Every fix with a copy-paste packet, alerts to Slack, PDF and CSV export.',
    agency: AGENCY_SHOWN,
    rows: SHOWN_SIGNUP_ROWS.map((r) =>
      r.startsWith('One competitor') ? 'PDF, CSV and JSON export, staging audits' : r,
    ),
    foot: LOCKED_SIGNUP_FOOT,
  },
  staging_deploys: {
    pro: PRO_SHOWN,
    agency: AGENCY_SHOWN,
    rows: SHOWN_SIGNUP_ROWS.map((r) =>
      r.startsWith('One competitor') ? 'One competitor, PDF, CSV and JSON export' : r,
    ),
    foot: LOCKED_SIGNUP_FOOT,
  },
  agency_white_label: {
    pro: PRO_SHOWN,
    agency: 'Twenty-five client sites, up to 2,000 pages a site, and five seats.',
    rows: SHOWN_SIGNUP_ROWS,
    foot: 'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites, $99 a month, 14-day trial with a card.',
  },
  agency_domain: {
    pro: PRO_SHOWN,
    agency:
      'Twenty-five client sites, up to 2,000 pages a site, five seats, and a one-page audit you can hand to a prospect.',
    rows: SHOWN_SIGNUP_ROWS,
    foot: 'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites, $99 a month, 14-day trial with a card.',
  },
};

describe('each switch drops its phrase, and only its phrase', () => {
  it.each(Object.keys(PER_SWITCH) as (keyof typeof PER_SWITCH)[])('%s', (name) => {
    const want = PER_SWITCH[name];
    const f = hide(name);
    expect(card('Pro', f).body).toBe(want.pro);
    expect(card('Agency', f).body).toBe(want.agency);
    // The rest of each card, and Free, as with nothing hidden.
    expect(cards(f).map((c) => ({ ...c, body: c.name === 'Free' ? c.body : '' }))).toEqual(
      SHOWN_HOME.map((c) => ({ ...c, body: c.name === 'Free' ? c.body : '' })),
    );
    const html = signupHtml(f);
    expect(tableRows(html)).toEqual(want.rows);
    expect(foot(html)).toBe(want.foot);
  });

  it('competitors hidden: neither page names a competitor', () => {
    expect(planSection(homeHtml(hide('competitors')))).not.toMatch(/competitor/i);
    expect(signupAside(signupHtml(hide('competitors')))).not.toMatch(/competitor/i);
  });

  it('staging_deploys hidden: neither page names staging or a preview deploy', () => {
    expect(signupAside(signupHtml())).toMatch(/staging/);
    for (const html of [
      planSection(homeHtml(hide('staging_deploys'))),
      signupAside(signupHtml(hide('staging_deploys'))),
    ]) {
      expect(html).not.toMatch(/staging|preview URL|before you deploy|deploy/i);
    }
  });

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: neither page names a logo, a domain, a brand or white label',
    (name) => {
      expect(planSection(homeHtml(hide(name)))).not.toMatch(/logo|your domain|brand|white.label/i);
      expect(signupAside(signupHtml(hide(name)))).not.toMatch(
        /logo|your domain|brand|white.label/i,
      );
    },
  );

  it.each(['ai_letter', 'nojs', 'rendering', 'sentinel'] as const)(
    '%s hidden: the cards, the table and the footer are as with nothing hidden',
    (name) => {
      expect(cards(hide(name))).toEqual(SHOWN_HOME);
      expect(tableRows(signupHtml(hide(name)))).toEqual(SHOWN_SIGNUP_ROWS);
      expect(foot(signupHtml(hide(name)))).toBe(LOCKED_SIGNUP_FOOT);
    },
  );
});

describe('the page limit follows pages_2000, with the figure from GATES', () => {
  const figure = count(GATES.pro.pagesPerCheck);

  it('shown: Pro and Agency state it on Home, Pro on Sign-up; Free’s 500 stays', () => {
    expect(GATES.agency.pagesPerCheck).toBe(GATES.pro.pagesPerCheck);
    expect(card('Pro').body).toContain(`up to ${figure} pages a site`);
    expect(card('Agency').body).toContain(`up to ${figure} pages a site`);
    expect(tableRows(signupHtml())).toContain(
      `Weekly checks, alerts to Slack, up to ${GATES.pro.sites} sites, up to ${figure} pages a site`,
    );
    expect(homeHtml()).toContain(`up to ${count(GATES.free.pagesPerCheck)} pages`);
  });

  it('hidden: no "2,000" on either surface, and Free’s limit stays', () => {
    const home = homeHtml(hide('pages_2000'));
    expect(planSection(home)).not.toContain(figure);
    expect(home).toContain(`up to ${count(GATES.free.pagesPerCheck)} pages`);
    const signup = signupAside(signupHtml(hide('pages_2000')));
    expect(signup).not.toContain(figure);
    expect(signup).toContain(`up to ${count(GATES.free.pagesPerCheck)} pages`);
  });

  it('the figure is read from GATES, not typed: a changed gate changes the words', async () => {
    vi.resetModules();
    vi.doMock('../../entitlement-v2', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../entitlement-v2')>();
      return {
        ...real,
        GATES: {
          ...real.GATES,
          pro: { ...real.GATES.pro, pagesPerCheck: 3456 },
          agency: { ...real.GATES.agency, pagesPerCheck: 3456 },
        },
      };
    });
    try {
      const { HomeScreen: Home } = await import('../../../components/v2/screens/home/HomeScreen');
      const { SignupScreen: Signup } =
        await import('../../../components/v2/screens/signup/SignupScreen');
      const { homePreview: preview } =
        await import('../../../app/(v2-preview)/v2-preview/_preview/screens');
      const home = planSection(renderToStaticMarkup(<Home data={preview()} />));
      expect(home.match(/up to 3,456 pages a site/g)).toHaveLength(2);
      expect(home).not.toContain('2,000');
      const signup = signupAside(renderToStaticMarkup(<Signup checksPublic={false} />));
      expect(signup).toContain('up to 3,456 pages a site');
      expect(signup).not.toContain('2,000');
    } finally {
      vi.doUnmock('../../entitlement-v2');
    }
  }, 60_000);
});

describe('Agency not on sale', () => {
  it('Home: no button, no card, trial or "charged" wording; one line that it opens, linking /agencies', () => {
    const agency = card('Agency', EVERY, false);
    expect(agency.action).toBeNull();
    expect(agency.note).toBe('The Agency plan opens shortly: For agencies');
    expect(agency.links).toEqual(['/agencies']);
    expect(JSON.stringify(agency)).not.toMatch(/card|trial|charged/i);
    // The body is the plan's, as on sale.
    expect(agency.body).toBe(AGENCY_SHOWN);
    // Free and Pro are as on sale.
    expect(cards(EVERY, false).filter((c) => c.name !== 'Agency')).toEqual(
      SHOWN_HOME.filter((c) => c.name !== 'Agency'),
    );
  });

  it('Sign-up: the footer names no trial and no card for Agency, and says the plan opens', () => {
    const f = foot(signupHtml(EVERY, false));
    expect(f).toBe(
      'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites under your brand, $99 a month. The Agency plan opens shortly.',
    );
    expect(f.slice(f.indexOf('Agencies:'))).not.toMatch(/trial|card|charged/i);
    expect(tableRows(signupHtml(EVERY, false))).toEqual(SHOWN_SIGNUP_ROWS);
  });

  it('closed, with the brand hidden: neither the brand nor the trial', () => {
    expect(foot(signupHtml(hide('agency_white_label'), false))).toBe(
      'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites, $99 a month. The Agency plan opens shortly.',
    );
  });
});

describe('the entry points read the switch and the flags', () => {
  const open = () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_BILLING_ONLY_USER', '');
    vi.stubEnv('V2_AGENCY_SALES', '1');
  };

  const liveHome = async () => {
    vi.resetModules();
    const { LiveHome } = await import('../../../components/v2/screens/home/LiveHome');
    return cardsOf(renderToStaticMarkup(<LiveHome />));
  };

  it('LiveHome: V2_HIDE_FEATURES drops the competitor and the page limit', async () => {
    open();
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors,pages_2000');
    const pro = (await liveHome()).find((c) => c.name === 'Pro')!;
    expect(pro.body).toBe(
      'Five sites, checked weekly. Every fix with a copy-paste packet, alerts to Slack, PDF and CSV export.',
    );
    vi.stubEnv('V2_HIDE_FEATURES', '');
    expect((await liveHome()).find((c) => c.name === 'Pro')!.body).toBe(PRO_SHOWN);
  }, 60_000);

  it('LiveHome: Agency’s trial note only with V2_BILLING public and V2_AGENCY_SALES on', async () => {
    open();
    expect((await liveHome()).find((c) => c.name === 'Agency')!.note).toBe(
      'Card required; nothing charged for 14 days',
    );
    vi.stubEnv('V2_AGENCY_SALES', '');
    expect((await liveHome()).find((c) => c.name === 'Agency')!.note).toBe(
      'The Agency plan opens shortly: For agencies',
    );
    open();
    vi.stubEnv('V2_BILLING', '');
    expect((await liveHome()).find((c) => c.name === 'Agency')!.note).toBe(
      'The Agency plan opens shortly: For agencies',
    );
    open();
    vi.stubEnv('V2_BILLING_ONLY_USER', 'some-user');
    expect((await liveHome()).find((c) => c.name === 'Agency')!.note).toBe(
      'The Agency plan opens shortly: For agencies',
    );
  }, 60_000);

  const signupPage = async () => {
    vi.resetModules();
    vi.stubEnv('V2_ACCOUNT_DOOR', '1');
    const { default: SignupPage } = await import('../../../app/(account)/signup/page');
    return renderToStaticMarkup(<SignupPage />);
  };

  it('/signup: V2_HIDE_FEATURES drops staging, the brand and the page limit', async () => {
    open();
    vi.stubEnv('V2_HIDE_FEATURES', 'staging_deploys,agency_domain,pages_2000');
    const html = await signupPage();
    expect(tableRows(html)).toContain('One competitor, PDF, CSV and JSON export');
    expect(tableRows(html)).toContain('Weekly checks, alerts to Slack, up to 5 sites');
    expect(foot(html)).toBe(
      'After 14 days the account is Free. Pro is $19 a month only if you choose it. Agencies: 25 sites, $99 a month, 14-day trial with a card.',
    );
  }, 60_000);

  it('/signup: the trial with a card only with V2_BILLING public and V2_AGENCY_SALES on', async () => {
    open();
    expect(foot(await signupPage())).toBe(LOCKED_SIGNUP_FOOT);
    vi.stubEnv('V2_AGENCY_SALES', '');
    expect(foot(await signupPage())).toContain('The Agency plan opens shortly.');
    open();
    vi.stubEnv('V2_BILLING', '');
    expect(foot(await signupPage())).not.toMatch(/trial with a card/);
  }, 60_000);
});
