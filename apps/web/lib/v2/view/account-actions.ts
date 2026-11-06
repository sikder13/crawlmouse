/**
 * Every action the account screens offer, and the route it posts or links to (D8). The previews
 * stop each form's submit, as KeepBar does; CC-26b implements these same paths, and CC-27 reuses
 * them. lib/v2/view/dashboard.ts re-exports them, where the brief looks for them.
 */
type Verb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteSpec {
  verb: Verb;
  /** The path, with `[id]`-style parameters, as ARCH-2 §5 names it. */
  route: string;
  /** Who builds the handler. */
  owner: 'CC-26b' | 'CC-27' | 'built';
  /** What the handler must check before acting (ARCH-2 §5, DECISION-LOG E6). */
  guard: string;
}

/**
 * Every action the account screens offer, and the route it posts or links to. The previews stop
 * each form's submit (as KeepBar does); CC-26b implements these same paths.
 */
export const ACCOUNT_ACTIONS = {
  addSite: {
    verb: 'POST',
    route: '/api/sites',
    owner: 'CC-26b',
    guard:
      'Signed-in member; primary sites below `limits.sites` (staging copies hold no slot, ARCH-2 §2.5).',
  },
  runCheck: {
    verb: 'POST',
    route: '/api/sites/[id]/checks',
    owner: 'CC-26b',
    guard:
      'Signed-in member of the site’s account; re-check debounce; manual re-checks per site per day: E6 says Free 2 / Pro 10 / Agency 10, `GATES.checksPerSiteDay` says 3 / 12 / 12 (owner ruling pending); queued, never refused.',
  },
  editSite: {
    verb: 'PATCH',
    route: '/api/sites/[id]',
    owner: 'CC-26b',
    guard:
      'Signed-in member; a weekly schedule needs a paid tier; competitor and staging need a paid tier and `limits.competitors_per_site`.',
  },
  removeSite: {
    verb: 'DELETE',
    route: '/api/sites/[id]',
    owner: 'CC-26b',
    guard: 'Signed-in member; sets `removed_at`; history kept.',
  },
  markDone: {
    verb: 'POST',
    route: '/api/fixes/[id]/done',
    owner: 'CC-26b',
    guard:
      'Signed-in member; the fix is visible to the tier (402 otherwise); queues a fix re-check.',
  },
  packet: {
    verb: 'GET',
    route: '/audit/[checkId]/fix/[fixId]',
    owner: 'built',
    guard: 'The fix page; its packet is 402 when the fix is not in the Free three on Free.',
  },
  copyFix: {
    verb: 'GET',
    route: '/api/fixes/[id]/packet',
    owner: 'CC-26b',
    guard: 'Signed-in member; 402 when the fix is not visible to the tier.',
  },
  emailDeveloper: {
    verb: 'POST',
    route: '/api/fixes/[id]/email-developer',
    owner: 'CC-26b',
    guard: 'Signed-in member; the fix is visible to the tier; rate limited as on the fix page.',
  },
  openAudit: {
    verb: 'GET',
    route: '/audit/[checkId]',
    owner: 'built',
    guard: 'Member read of an owned check.',
  },
  sitePage: {
    verb: 'GET',
    route: '/sites/[id]',
    owner: 'CC-26b',
    guard: 'Signed-in member of the site’s account.',
  },
  changeLog: { verb: 'GET', route: '/changes', owner: 'CC-27', guard: 'Signed-in member.' },
  keepPlan: {
    verb: 'POST',
    route: '/api/billing/checkout',
    owner: 'built',
    guard: 'Signed-in owner; the account’s state allows the plan (not already on it).',
  },
  startTrial: {
    verb: 'POST',
    route: '/api/billing/pro-trial/start',
    owner: 'CC-26b',
    guard:
      'Signed-in owner; state `free` with no trial in `state_history` (H5); trial-ledger check.',
  },
  integrations: {
    verb: 'GET',
    route: '/settings/integrations',
    owner: 'CC-27',
    guard: 'Owner or manager.',
  },
  plan: { verb: 'GET', route: '/settings/plan', owner: 'CC-27', guard: 'Signed-in owner.' },
  pricing: { verb: 'GET', route: '/pricing', owner: 'built', guard: 'None.' },
  emailSettings: { verb: 'GET', route: '/settings', owner: 'CC-27', guard: 'Owner or manager.' },
  theme: {
    verb: 'PATCH',
    route: '/api/me',
    owner: 'CC-26b',
    guard: 'Signed-in user; `{theme}` only.',
  },
  reports: {
    verb: 'POST',
    route: '/api/reports',
    owner: 'CC-27',
    guard: 'Signed-in member; exports need a paid tier.',
  },
  alertRules: {
    verb: 'PUT',
    route: '/api/sites/[id]/alert-rules',
    owner: 'CC-27',
    guard: 'Signed-in member; Slack needs a paid tier.',
  },
  publicReport: {
    verb: 'GET',
    route: '/r/[slug]',
    owner: 'built',
    guard: 'None (a minted public report).',
  },
} as const satisfies Record<string, RouteSpec>;

export type ActionKey = keyof typeof ACCOUNT_ACTIONS;

export interface ActionView {
  label: string;
  /** The route pattern from ACCOUNT_ACTIONS, so a test can tie the button to its route. */
  route: string;
  /** The concrete path, its parameters filled. */
  href: string;
  /** A link for GET; otherwise a POST form, with `_method` naming the verb HTML forms lack. */
  method: 'get' | 'post';
  fields: Record<string, string>;
  /** The screen's one orange element (rule 3). */
  primary: boolean;
}

/** An action, its route's parameters filled from `params`. */
export function action(
  key: ActionKey,
  label: string,
  params: Record<string, string> = {},
  {
    primary = false,
    query = '',
    fields = {},
  }: { primary?: boolean; query?: string; fields?: Record<string, string> } = {},
): ActionView {
  const spec: RouteSpec = ACCOUNT_ACTIONS[key];
  const href = spec.route.replace(/\[(\w+)\]/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${spec.route} needs ${name}`);
    return encodeURIComponent(value);
  });
  return {
    label,
    route: spec.route,
    href: `${href}${query}`,
    method: spec.verb === 'GET' ? 'get' : 'post',
    fields:
      spec.verb === 'GET' || spec.verb === 'POST' ? fields : { _method: spec.verb, ...fields },
    primary,
  };
}

/** The rail's links, in the locked order. */
export const ACCOUNT_NAV = [
  { label: 'Sites', href: '/dashboard' },
  { label: 'Changes', href: '/changes' },
  { label: 'Alerts', href: '/alerts' },
  { label: 'Competitors', href: '/competitors' },
  { label: 'Reports', href: '/reports' },
  { label: 'Integrations', href: '/settings/integrations' },
  { label: 'Settings', href: '/settings' },
] as const;
