/**
 * Every action the account screens offer, and the route it posts or links to (D8). A preview
 * stops each form's submit, as KeepBar does; a live page (`LiveActions`) submits it. The step each
 * entry's `owner` names builds the handler on that same path. lib/v2/view/dashboard.ts re-exports them, where the brief looks for them.
 */
type Verb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteSpec {
  verb: Verb;
  /** The path, with `[id]`-style parameters, as ARCH-2 §5 names it. */
  route: string;
  /** Who builds the handler. */
  owner: 'CC-26b' | 'CC-27b' | 'built';
  /** What the handler must check before acting (ARCH-2 §5, DECISION-LOG E6). */
  guard: string;
}

/**
 * Every action the account screens offer, and the route it posts or links to; `owner` names the
 * step that builds the handler.
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
      'Signed-in member of the site’s account; re-check debounce; manual and fix re-checks per site per rolling 24 hours, `GATES.manualChecksPerSiteDay` (Free 2 / Pro 10 / Agency 10); over the cap it is refused with 429 and when the next is allowed.',
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
  changeLog: { verb: 'GET', route: '/changes', owner: 'CC-27b', guard: 'Signed-in member.' },
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
    owner: 'CC-27b',
    guard: 'Owner or manager.',
  },
  plan: { verb: 'GET', route: '/settings/plan', owner: 'CC-27b', guard: 'Signed-in owner.' },
  pricing: { verb: 'GET', route: '/pricing', owner: 'built', guard: 'None.' },
  emailSettings: { verb: 'GET', route: '/settings', owner: 'CC-27b', guard: 'Owner or manager.' },
  theme: {
    verb: 'PATCH',
    route: '/api/me',
    owner: 'CC-26b',
    guard: 'Signed-in user; `{theme}` only.',
  },
  reports: {
    verb: 'POST',
    route: '/api/reports',
    owner: 'CC-27b',
    guard: 'Signed-in member; exports need a paid tier.',
  },
  alertRules: {
    verb: 'PUT',
    route: '/api/sites/[id]/alert-rules',
    owner: 'CC-27b',
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
  /**
   * Read after the label by a screen reader only, where the same label recurs on a page: "Diff"
   * for which change, "Packet" for which fix (WCAG 2.4.4).
   */
  context: string | null;
  /**
   * The fields the person fills before posting (the add-site address, a site's schedule); a live
   * page shows them, a preview does not.
   */
  inputs?: readonly ActionInput[];
  /**
   * A read whose answer is a fix's packet and its prompt: a live page copies the prompt instead of
   * opening the JSON.
   */
  copy?: true;
}

export type ActionInput =
  | {
      kind: 'text';
      name: string;
      label: string;
      type: 'text' | 'url' | 'email';
      placeholder: string;
      /** What the field holds when the page opens (a site's competitors as they stand). */
      value?: string;
      required: boolean;
    }
  | {
      kind: 'select';
      name: string;
      label: string;
      options: readonly { value: string; label: string }[];
      value: string;
      /**
       * Posted only while the select named `name` holds one of `values`: a disabled control is not
       * sent (the schedule's weekday and hour, with no schedule chosen).
       */
      while?: { name: string; values: readonly string[] };
    }
  | { kind: 'checkbox'; name: string; label: string; value: string; required: true };

/** An action, its route's parameters filled from `params`. */
export function action(
  key: ActionKey,
  label: string,
  params: Record<string, string> = {},
  {
    primary = false,
    query = '',
    fields = {},
    context = null,
    inputs,
    copy,
  }: {
    primary?: boolean;
    query?: string;
    fields?: Record<string, string>;
    context?: string | null;
    inputs?: readonly ActionInput[];
    copy?: true;
  } = {},
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
    context,
    ...(inputs ? { inputs } : {}),
    ...(copy ? { copy } : {}),
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
