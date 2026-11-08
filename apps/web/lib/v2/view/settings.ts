/**
 * Settings (Final-Settings) as data, and the routes CC-27b builds for the account screens CC-27
 * previews (D6: their target paths are constants here). The previews post to these paths and stop
 * the submit; CC-27b implements the handlers on the same paths. The routes CC-26 had already named
 * (`ACCOUNT_ACTIONS`) stay there; these are the ones ARCH-2 §5 lists for the account pages, plus
 * the ones it does not have, each marked as such in its guard (owner ruling 6).
 */
import type { ActionView, RouteSpec } from './account-actions';

export const CC27B_ROUTES = {
  accountAlertRules: {
    verb: 'PUT',
    route: '/api/alert-rules',
    owner: 'CC-27b',
    guard:
      'Signed-in member; the account’s rules (`site_id` null); Slack needs a paid tier. ARCH-2 §5 has only the per-site route: this one is CC-27b’s contract (owner ruling 6).',
  },
  account: {
    verb: 'PATCH',
    route: '/api/account',
    owner: 'CC-27b',
    guard:
      'Owner or manager; `{name, timezone, email_prefs, newEmail}`. A changed `newEmail` starts the `/api/account/email` confirmation instead of saving it. `email_prefs` is not in ARCH-2 §5: CC-27b’s contract (owner ruling 6).',
  },
  emailChange: {
    verb: 'POST',
    route: '/api/account/email',
    owner: 'CC-27b',
    guard:
      'Signed-in owner; sends a confirmation link to the new address (GET renders, POST confirms); writes `account_events`.',
  },
  deleteAccount: {
    verb: 'DELETE',
    route: '/api/account',
    owner: 'CC-27b',
    guard:
      'Signed-in owner and the re-typed hostname; sign-in disabled at once; Stripe subscription cancelled; `account.deleted`, restorable for 7 days by a sign-in link (`POST /api/account/restore`), then Storage purged and the account hard-deleted.',
  },
  billingPortal: {
    verb: 'POST',
    route: '/api/billing/portal',
    owner: 'built',
    guard:
      'Signed-in owner; opens the Stripe portal, where receipts are listed and a plan is cancelled.',
  },
  reportDownload: {
    verb: 'GET',
    route: '/api/reports/[id]/download',
    owner: 'CC-27b',
    guard: 'Signed-in member of the report’s account; redirects to a 10-minute signed URL.',
  },
  reportShare: {
    verb: 'POST',
    route: '/api/reports/[id]/share',
    owner: 'CC-27b',
    guard: 'Signed-in member; a share link works for 30 days and needs no account to open.',
  },
  trialEnded: {
    verb: 'GET',
    route: '/trial-ended',
    owner: 'CC-27b',
    guard:
      'Signed-in member. Serves both states: before the end (this preview, and the reminder email’s link) and after it (ARCH-2 §5: “free after trial”). The dashboard banner links to it (owner ruling 6).',
  },
} as const satisfies Record<string, RouteSpec>;

export type Cc27bKey = keyof typeof CC27B_ROUTES;

/**
 * One of these routes as an action, built as `action()` builds the account screens' others (a link
 * for GET; otherwise a POST form, the verb in `_method`), so ActionControl draws either alike.
 */
export function routeAction(
  key: Cc27bKey,
  label: string,
  params: Record<string, string> = {},
  {
    primary = false,
    fields = {},
    context = null,
  }: { primary?: boolean; fields?: Record<string, string>; context?: string | null } = {},
): ActionView {
  const spec: RouteSpec = CC27B_ROUTES[key];
  const href = spec.route.replace(/\[(\w+)\]/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${spec.route} needs ${name}`);
    return encodeURIComponent(value);
  });
  return {
    label,
    route: spec.route,
    href,
    method: spec.verb === 'GET' ? 'get' : 'post',
    fields:
      spec.verb === 'GET' || spec.verb === 'POST' ? fields : { _method: spec.verb, ...fields },
    primary,
    context,
  };
}
