/**
 * Q24/Q31 (SEO-conversion N2): every link and form the Pricing and Agency trial pages render reaches
 * a page or route that is served under the flags the page was rendered with.
 *
 * Each target is resolved to its file under apps/web/app (route groups entered, the preview group
 * left out, a dynamic segment matched by any value), with each layout above it. A file that answers
 * 404 behind a flag says so as `if (!<flag>()) … notFound()` or `refuse(404`; those flag functions
 * are read from the files themselves and evaluated against the environment the page was built from.
 * A target that resolves to no file fails. What it cannot see: a 404 decided another way, such as
 * middleware's rewrite targets, which these pages do not link to.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgencyTrialScreen } from '../../components/v2/screens/agency-trial/AgencyTrialScreen';
import { PricingScreen } from '../../components/v2/screens/pricing/PricingScreen';
import * as authFlags from '../../lib/auth/flags';
import * as billingFlags from '../../lib/billing/flags';
import { FREE_START, TRIAL_DAYS } from '../../lib/billing/state-machine';
import { agencyStanding, agencyTrialView } from '../../lib/v2/view/agency-trial';
import { pricingView, type PricingViewer } from '../../lib/v2/view/pricing';

type Env = Record<string, string | undefined>;
const FLAG_FUNCTIONS: Record<string, (env: Env) => boolean> = {
  ...(authFlags as unknown as Record<string, (env: Env) => boolean>),
  ...(billingFlags as unknown as Record<string, (env: Env) => boolean>),
};

const APP = join(__dirname, '..', '..', 'app');
const NOW = new Date('2026-11-12T12:00:00Z');
const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';
const AGENCY = 'a0000000-0000-4000-8000-00000000000b';

/** The page or route file serving `path`, and the layouts above it; null when none does. */
function resolve(path: string): string[] | null {
  const segments = path.split('/').filter(Boolean);
  function walk(dir: string, rest: string[], layouts: string[]): string[] | null {
    const here = existsSync(join(dir, 'layout.tsx'))
      ? [...layouts, join(dir, 'layout.tsx')]
      : layouts;
    if (rest.length === 0) {
      for (const f of ['page.tsx', 'route.ts']) {
        if (existsSync(join(dir, f))) return [...here, join(dir, f)];
      }
    }
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (rest.length > 0 && entries.some((e) => e.name === rest[0])) {
      const found = walk(join(dir, rest[0]!), rest.slice(1), here);
      if (found) return found;
    }
    for (const e of entries) {
      if (/^\(.*\)$/.test(e.name) && e.name !== '(v2-preview)') {
        const found = walk(join(dir, e.name), rest, here);
        if (found) return found;
      }
    }
    if (rest.length > 0) {
      for (const e of entries.filter((d) => /^\[[^.]+\]$/.test(d.name))) {
        const found = walk(join(dir, e.name), rest.slice(1), here);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(APP, segments, []);
}

const GATE = /if\s*\(\s*!\s*(\w+)\(\)\s*\)\s*(?:return\s+)?(?:notFound\(\)|refuse\(\s*404)/g;

/** The flag functions a file answers 404 behind. */
const gatesOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(GATE)].map((m) => m[1]!);

/** Each link and form target of the markup, without its query or fragment; in-page anchors left out. */
function targets(html: string): string[] {
  const doc = new JSDOM(html).window.document;
  const raw = [
    ...[...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!),
    ...[...doc.querySelectorAll('form[action]')].map((f) => f.getAttribute('action')!),
  ];
  return raw
    .filter((t) => !t.startsWith('#') && !t.startsWith('mailto:'))
    .map((t) => t.split(/[?#]/)[0]!);
}

const ENVS: Env[] = [];
for (const door of ['1', undefined])
  for (const checks of ['1', undefined])
    ENVS.push({ V2_BILLING: '1', V2_ACCOUNT_DOOR: door, V2_CHECKS_PUBLIC: checks });

const VIEWERS: [string, PricingViewer][] = [
  ['signed out', { kind: 'signed_out' }],
  [
    'free, trial open',
    {
      kind: 'signed_in',
      account: { id: ACCOUNT, owner: true, tier: 'free', snapshot: FREE_START, customer: null },
      agency: { held: false, used: null },
    },
  ],
  [
    'lapsed, subscription kept, agency trial used',
    {
      kind: 'signed_in',
      account: {
        id: ACCOUNT,
        owner: true,
        tier: 'free',
        snapshot: { ...FREE_START, trialUsedAt: NOW, subscriptionId: 'sub_1' },
        customer: 'cus_1',
      },
      agency: {
        held: false,
        used: {
          account: { id: AGENCY, snapshot: { ...FREE_START, trialUsedAt: NOW }, customer: null },
        },
      },
    },
  ],
  [
    'free, Pro trial used',
    {
      kind: 'signed_in',
      account: {
        id: ACCOUNT,
        owner: true,
        tier: 'free',
        snapshot: { ...FREE_START, trialUsedAt: NOW },
        customer: 'cus_1',
      },
      agency: { held: false, used: null },
    },
  ],
];

function pages(env: Env): [string, string][] {
  const flags = {
    accountDoor: authFlags.accountDoorEnabled(env),
    checksPublic: authFlags.checksPublicEnabled(env),
  };
  const pricing = VIEWERS.map(
    ([name, viewer]) =>
      [
        `pricing, ${name}`,
        renderToStaticMarkup(<PricingScreen view={pricingView(viewer, 'month', NOW, flags)} />),
      ] as [string, string],
  );
  const row = {
    id: AGENCY,
    role: 'owner',
    name: 'Summit',
    state: 'agency_trial' as const,
    tier: 'agency' as const,
    pastDueTier: null,
    pastDueSince: null,
    trialVariant: 'card_required' as const,
    trialEndsAt: new Date('2026-11-20T00:00:00Z'),
    trialUsedAt: NOW,
    subscriptionId: 'sub_1',
    billingEnd: null,
    firstSite: null,
  };
  const used = { accountId: AGENCY, trialUsedAt: NOW, deleted: false };
  const trial = [
    ['new', [], null, null],
    ['held, cancel asked', [row], used, AGENCY],
  ] as const;
  return [
    ...pricing,
    ...trial.map(
      ([name, rows, u, ask]) =>
        [
          `agency trial, ${name}`,
          renderToStaticMarkup(
            <AgencyTrialScreen
              view={agencyTrialView(
                {
                  email: 'me@summit.agency',
                  interval: 'month',
                  timeZone: 'UTC',
                  standing: agencyStanding([...rows], u, NOW),
                  customers: new Map([[AGENCY, 'cus_1']]),
                  cancelAsked: ask,
                },
                NOW,
              )}
            />,
          ),
        ] as [string, string],
    ),
  ];
}

describe('each target is served under the flags its page was rendered with', () => {
  const gatesSeen = new Set<string>();

  it.each(ENVS)('%j', (env) => {
    for (const [name, html] of pages(env)) {
      const found = targets(html);
      expect(found.length, name).toBeGreaterThan(3);
      for (const target of found) {
        const files = resolve(target);
        expect(files, `${name}: ${target} resolves to no file under app/`).not.toBeNull();
        for (const gate of files!.flatMap(gatesOf)) {
          gatesSeen.add(gate);
          expect(FLAG_FUNCTIONS[gate], `${target}: ${gate} is not a flag function`).toBeTypeOf(
            'function',
          );
          expect(FLAG_FUNCTIONS[gate]!(env), `${name}: ${target} is a 404 behind ${gate}`).toBe(
            true,
          );
        }
      }
    }
  });

  // Run after the sweep: the gates this test exists for were read from the targets' own files.
  it('read the gates of Sign-up, the Pro trial and the billing routes from their files', () => {
    expect([...gatesSeen].sort()).toEqual(
      expect.arrayContaining(['accountDoorEnabled', 'billingV2Enabled', 'checksPublicEnabled']),
    );
  });
});

describe('the reader', () => {
  it('resolves through route groups and finds a 404 gate', () => {
    const signup = resolve('/signup')!;
    expect(signup.at(-1)).toMatch(/\(account\)\/signup\/page\.tsx$/);
    expect(signup.flatMap(gatesOf)).toEqual(['accountDoorEnabled']);
    expect(resolve('/api/billing/pro-trial/start')!.flatMap(gatesOf)).toEqual([
      'checksPublicEnabled',
    ]);
    expect(resolve('/no-such-page')).toBeNull();
  });
});

// SEO R2-N1: the Pro column's words follow its button. Where the button starts the no-card trial, or
// signs in to a page that then offers it, the page says "no card"; where it takes a card (Checkout,
// the portal, or a sign-in to a page with no trial route), nothing on the page says otherwise. The
// way is read from the rendered button's target and the flags, not from the view.
describe('the Pro column’s words follow its button, under each flag combination', () => {
  const NO_CARD_TAG = `free for ${TRIAL_DAYS} days, no card`;
  const NO_CARD_FAQ = `No. The ${TRIAL_DAYS} days start with your email.`;

  /** The Pro card: the nearest ancestor of its heading that holds its button. */
  function proCard(html: string): Element {
    const doc = new JSDOM(html).window.document;
    const h2 = [...doc.querySelectorAll('h2')].find((h) => h.textContent === 'Pro')!;
    let el: Element | null = h2;
    while (el && !el.querySelector('a[href], form[action]')) el = el.parentElement;
    return el!;
  }

  const ways = new Set<string>();
  it.each(ENVS)('%j', (env) => {
    const flags = {
      accountDoor: authFlags.accountDoorEnabled(env),
      checksPublic: authFlags.checksPublicEnabled(env),
    };
    for (const [name, viewer] of VIEWERS) {
      for (const interval of ['month', 'year'] as const) {
        const html = renderToStaticMarkup(
          <PricingScreen view={pricingView(viewer, interval, NOW, flags)} />,
        );
        const card = proCard(html);
        const target = (
          card.querySelector('form[action]')?.getAttribute('action') ??
          card.querySelector('a[href]')!.getAttribute('href')!
        ).split(/[?#]/)[0]!;
        const trial =
          target === '/signup' ||
          target === '/api/billing/pro-trial/start' ||
          (target === '/login' && flags.checksPublic);
        ways.add(`${target}${target === '/login' ? ` checksPublic=${flags.checksPublic}` : ''}`);
        const text = card.textContent ?? '';
        const label = `${name}, ${interval}: ${target}`;
        expect(text.includes(NO_CARD_TAG), label).toBe(trial);
        expect(html.includes(NO_CARD_FAQ), label).toBe(trial);
        expect(html.includes(`What happens when the ${TRIAL_DAYS} days end`), label).toBe(trial);
        expect(/\bno card\b/i.test(text), label).toBe(trial);
        if (!trial) expect(html, label).not.toMatch(/start with your email/);
        else expect(text, label).not.toMatch(/card (?:is )?taken/);
      }
    }
  });

  it('reached every way the Pro button goes', () => {
    expect([...ways].sort()).toEqual([
      '/api/billing/checkout',
      '/api/billing/portal',
      '/api/billing/pro-trial/start',
      '/login checksPublic=false',
      '/login checksPublic=true',
      '/signup',
    ]);
  });
});
