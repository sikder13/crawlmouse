/**
 * The QA account set (CC-38 D1; the design is notes' launch-readiness §4): who each test account is,
 * which account it lands on, its sites, its seat and the plan `--billing` gives it. Data only; the
 * seed (./seed.ts) reads it.
 *
 * Every host is in `QA_HOSTS`. Besides the owner's two domains they are subdomains of
 * `lab.nahltech.com`, named by the role the site plays, so a production seed checks no third
 * party's site on a schedule (docs/specs/v2/38-launch-qa.md, Q7).
 */

export const QA_KEYS = [
  'free',
  'protrial',
  'pro',
  'agency',
  'agency-dev',
  'agencytrial',
  'demo',
] as const;
export type QaKey = (typeof QA_KEYS)[number];

export const QA_HOSTS = {
  nahltech: 'nahltech.com',
  crawlmouse: 'crawlmouse.com',
  healthy: 'healthy.lab.nahltech.com',
  appShell: 'app-shell.lab.nahltech.com',
  cfBlocked: 'cf-blocked.lab.nahltech.com',
  clients: [1, 2, 3, 4, 5, 6].map((n) => `client-${n}.lab.nahltech.com`),
  demo: [1, 2, 3].map((n) => `demo-${n}.lab.nahltech.com`),
} as const;

/** Where the person's work lives: their own account, a second (agency) account, or a seat on one. */
export type Home =
  | { kind: 'personal' }
  | { kind: 'agency'; name: string }
  | { kind: 'seat'; on: QaKey; role: 'developer'; clients: 'first' };

/** The plan `--billing` opens a Checkout for; null for an account that stays on what part (a) gives. */
export type QaPlan = { plan: 'pro' | 'agency'; interval: 'month'; trial: boolean } | null;

export interface QaAccount {
  key: QaKey;
  /** The state the set is meant to hold once both parts have run. */
  state: string;
  home: Home;
  sites: readonly string[];
  /** Part (a) starts the no-card Pro trial through the real trial function. */
  proTrial: boolean;
  billing: QaPlan;
}

export const QA_ACCOUNTS: readonly QaAccount[] = [
  {
    key: 'free',
    state: 'Free after trial',
    home: { kind: 'personal' },
    sites: [QA_HOSTS.nahltech],
    proTrial: false,
    billing: null,
  },
  {
    key: 'protrial',
    state: 'Pro trial, day 1',
    home: { kind: 'personal' },
    sites: [QA_HOSTS.crawlmouse],
    proTrial: true,
    billing: null,
  },
  {
    key: 'pro',
    state: 'Pro, paid monthly',
    home: { kind: 'personal' },
    sites: [
      QA_HOSTS.crawlmouse,
      QA_HOSTS.nahltech,
      QA_HOSTS.healthy,
      QA_HOSTS.appShell,
      QA_HOSTS.cfBlocked,
    ],
    proTrial: false,
    billing: { plan: 'pro', interval: 'month', trial: false },
  },
  {
    key: 'agency',
    state: 'Agency, paid',
    home: { kind: 'agency', name: 'QA Agency' },
    sites: QA_HOSTS.clients,
    proTrial: false,
    billing: { plan: 'agency', interval: 'month', trial: false },
  },
  {
    key: 'agency-dev',
    state: 'developer seat on qa+agency, scoped to one client',
    home: { kind: 'seat', on: 'agency', role: 'developer', clients: 'first' },
    sites: [],
    proTrial: false,
    billing: null,
  },
  {
    key: 'agencytrial',
    state: 'Agency trial, card on file',
    home: { kind: 'agency', name: 'QA Agency Trial' },
    sites: [QA_HOSTS.clients[0]!],
    proTrial: false,
    billing: { plan: 'agency', interval: 'month', trial: true },
  },
  {
    key: 'demo',
    state: 'Agency, for sales calls and videos',
    home: { kind: 'agency', name: 'Demo Agency' },
    sites: QA_HOSTS.demo,
    proTrial: false,
    billing: { plan: 'agency', interval: 'month', trial: false },
  },
];

export function qaAccount(key: QaKey): QaAccount {
  const a = QA_ACCOUNTS.find((x) => x.key === key);
  if (!a) throw new Error(`no QA account ${key}`);
  return a;
}
