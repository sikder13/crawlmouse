/**
 * The account door's screens (CC-25): each reads as its locked HTML with the registered changes and
 * nothing else; every number on them comes from a constant; the flag and the inputs that decide
 * the copy do decide it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignupScreen } from '../../components/v2/screens/signup/SignupScreen';
import { CheckEmailScreen } from '../../components/v2/screens/check-email/CheckEmailScreen';
import { ContinueScreen } from '../../components/v2/screens/continue/ContinueScreen';
import { checkEmailHref } from '../../components/v2/screens/signup/SignupForm';
import { emailKindsSentence, planGroups } from '../../components/v2/screens/signup/door-copy';
import { maskEmail } from '../../lib/auth/mask-email';
import { GATES } from '../../lib/entitlement-v2';
import { TRIAL_DAYS } from '../../lib/billing/state-machine';
import * as prices from '../../lib/billing/prices';
import {
  AUTH_LINK_MINUTES,
  EMAIL_KINDS,
  FIRST_AUDIT_MINUTES,
  SIGNIN_SENDER,
  TRIAL_REMINDER_DAYS_BEFORE_END,
} from '../../lib/auth/constants';
import { ANONYMOUS_VISIBLE_MS } from '../../lib/v2/view/result';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const signup = (pipeline = false) => renderToStaticMarkup(<SignupScreen pipeline={pipeline} />);
const checkEmail = (
  kind: 'signin' | 'named-site' | 'from-audit',
  site: string | null,
  pipeline = false,
) =>
  renderToStaticMarkup(
    <CheckEmailScreen kind={kind} site={site} pipeline={pipeline} email="you@company.com" />,
  );

const LOCKS = [
  { file: 'Final-Signup.dc.html', screen: 'signup', html: () => signup() },
  {
    file: 'Final-CheckEmail.dc.html',
    screen: 'check-email',
    html: () => checkEmail('from-audit', 'example-outfitter.com'),
  },
  {
    file: 'Final-CheckEmail-NoAudit.dc.html',
    screen: 'check-email-no-audit',
    html: () => checkEmail('named-site', 'acme-outdoors.com'),
  },
] as const;

describe.each(LOCKS)('$file', ({ file, screen, html }) => {
  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    const diff = firstDifference(
      expected(withoutShell(locked(file)).rest, screen),
      renderedText(withoutShell(html()).rest, screen),
    );
    expect(diff).toBeNull();
  });
});

/** Every run of digits in the visible text outside the shell (the footer owns its year), as numbers. */
const numbersIn = (markup: string) =>
  [...renderedText(withoutShell(markup).rest).matchAll(/\d[\d,]*/g)].map((m) =>
    Number(m[0].replace(/,/g, '')),
  );

describe('every number on the door comes from a constant', () => {
  const owned = new Set([
    TRIAL_DAYS,
    AUTH_LINK_MINUTES,
    prices.PRO_MONTHLY,
    prices.AGENCY_MONTHLY,
    GATES.free.pagesPerCheck,
    GATES.pro.sites,
    GATES.agency.sites,
    ANONYMOUS_VISIBLE_MS / 3_600_000,
  ]);
  it.each([
    ['Sign-up', signup()],
    ['Sign-up, pipeline on', signup(true)],
    ['Check-email, from an audit', checkEmail('from-audit', 'example-outfitter.com')],
    ['Check-email, named site', checkEmail('named-site', 'acme-outdoors.com', true)],
    ['Check-email, sign-in', checkEmail('signin', null)],
    ['Continue', renderToStaticMarkup(<ContinueScreen state="idle" />)],
    ['Continue, expired', renderToStaticMarkup(<ContinueScreen state="expired" />)],
  ])('%s', (_, markup) => {
    const stray = numbersIn(markup).filter((n) => !owned.has(n));
    expect(stray).toEqual([]);
  });

  it('the Agency price is the 2026-11-03 decision, not the artboard', () => {
    expect(signup()).toContain(
      `Agencies: ${GATES.agency.sites} sites under your brand, $99 a month`,
    );
    expect(signup()).not.toContain('$69');
  });

  it('the plan table is built from GATES', () => {
    const rows = planGroups().flatMap((g) => g.rows.map((r) => r.what));
    expect(rows).toContain(`One site, up to ${GATES.free.pagesPerCheck} pages, re-checked monthly`);
    expect(rows).toContain(`Weekly checks, alerts to Slack, up to ${GATES.pro.sites} sites`);
    expect(rows).toContain('Three complete fixes per audit, with packets');
  });

  it('the email sentence names each kind in EMAIL_KINDS, and the reminder from its constant', () => {
    const s = emailKindsSentence();
    expect(s.startsWith('Three kinds of email')).toBe(EMAIL_KINDS.length === 3);
    expect(s).toContain(`one reminder three days before the ${TRIAL_DAYS} days end`);
    expect(TRIAL_REMINDER_DAYS_BEFORE_END).toBe(3);
  });
});

describe('Check-email', () => {
  it('names the sender the link really comes from today', () => {
    expect(SIGNIN_SENDER).toBe('magic@crawlmouse.com');
    expect(checkEmail('signin', null)).toContain('magic@crawlmouse.com');
    expect(checkEmail('signin', null)).not.toContain('signin@crawlmouse.com');
  });

  it('shows the address masked: the local part shortened, the domain whole', () => {
    expect(maskEmail('you@company.com')).toBe('y…@company.com');
    expect(maskEmail('a@b.co')).toBe('a@b.co');
    expect(maskEmail('nope')).toBeNull();
    expect(checkEmail('signin', null)).toContain('y…@company.com');
    expect(checkEmail('signin', null)).not.toContain('you@company.com');
  });

  it('promises a first audit only when the pipeline that starts it is on (D6)', () => {
    const on = checkEmail('named-site', 'acme-outdoors.com', true);
    const off = checkEmail('named-site', 'acme-outdoors.com', false);
    expect(on).toContain('starts the moment you open it');
    expect(on).toContain(`about ${['zero', 'one', 'two'][FIRST_AUDIT_MINUTES]} minutes`);
    expect(off).not.toContain('starts the moment');
    expect(off).toContain('is added to your account when you open it, if the account has room');
    // With nothing running checks, no cadence and no alerts sender is promised (D6).
    for (const html of [off, checkEmail('from-audit', 'x.com', false)]) {
      expect(html).not.toContain('re-checked');
      expect(html).not.toContain('alerts@');
    }
    expect(checkEmail('from-audit', 'x.com', true)).toContain('re-checked weekly');
    expect(signup(false)).not.toContain('Running an audit right now?');
    expect(signup(true)).toContain('Running an audit right now?');
    expect(signup(false)).not.toContain('first audit starts');
    expect(signup(true)).toContain('first audit starts the moment you open the sign-in link');
  });

  it('the sign-in kind has no card and promises no site', () => {
    const html = checkEmail('signin', null);
    expect(html).not.toContain('Opening the link');
    expect(html).toContain('The link signs you in and opens your dashboard.');
  });

  it('a Keep and a named site route to their kinds; the host goes in the URL, the email never', () => {
    expect(checkEmailHref({ email: 'a@b.co', site: 'Acme.com/x' })).toBe(
      '/check-email?kind=named-site&site=acme.com',
    );
    expect(checkEmailHref({ email: 'a@b.co' })).toBe('/check-email?kind=signin');
    expect(checkEmailHref({ email: 'a@b.co', site: '10.0.0.1' })).toBe('/check-email?kind=signin');
  });
});

describe('the orange convention, from the registry', () => {
  const door = PREVIEWS.filter((p) => /\/screens\/(signup|check-email|continue)/.test(p.path));
  it('lists the eight door previews', () => {
    expect(door).toHaveLength(8);
  });
  it.each([
    ['Sign-up', signup(), 1],
    ['Check-email', checkEmail('from-audit', 'x.com'), 0],
    ['Continue', renderToStaticMarkup(<ContinueScreen state="idle" />), 1],
    ['Continue, expired', renderToStaticMarkup(<ContinueScreen state="expired" />), 1],
  ])('%s shows %#: its registered count of orange elements', (_, markup, n) => {
    expect((markup.match(/data-v2-primary=""/g) ?? []).length).toBe(n);
  });
});

describe('the routes, by the flag (D1)', () => {
  const pages = async () => ({
    signup: (await import('../../app/(account)/signup/page')).default,
    checkEmail: (await import('../../app/(account)/check-email/page')).default,
  });
  const params = (p: Record<string, string>) => ({ searchParams: Promise.resolve(p) });

  it('/signup and /check-email are 404s with V2_ACCOUNT_DOOR unset', async () => {
    delete process.env.V2_ACCOUNT_DOOR;
    const { signup: Signup, checkEmail: CheckEmail } = await pages();
    expect(() => Signup()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(CheckEmail(params({ kind: 'signin' }))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    );
  });

  it('render with V2_ACCOUNT_DOOR=1; a site that is not a hostname reads as the sign-in kind', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    try {
      const { signup: Signup, checkEmail: CheckEmail } = await pages();
      expect(renderToStaticMarkup(Signup())).toContain('Send my sign-in link');
      const bad = renderToStaticMarkup(
        await CheckEmail(params({ kind: 'named-site', site: '<script>alert(1)</script>' })),
      );
      expect(bad).not.toContain('script');
      expect(bad).toContain('The link signs you in and opens your dashboard.');
      const good = renderToStaticMarkup(
        await CheckEmail(params({ kind: 'from-audit', site: 'Example-Outfitter.com' })),
      );
      expect(good).toContain('example-outfitter.com');
    } finally {
      delete process.env.V2_ACCOUNT_DOOR;
    }
  });
});
