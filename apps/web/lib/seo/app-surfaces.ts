/**
 * Every top-level route folder under `app/` that the sitemap does not list, and why. The audit asks
 * each `APP_SURFACES` path, in both builds, and reports what it answers: a page meant for a signed-in
 * person or a single recipient must not be indexable (OPERATING-RULES §13), so it answers noindex,
 * redirects, or is not found. `app-surfaces.test.ts` fails on a folder that is in none of the lists
 * below, so a new route is classified when it is added.
 */

/** One path per app surface, with a placeholder where the route takes an id. */
export const APP_SURFACES: readonly string[] = [
  '/login',
  '/signup',
  '/check-email',
  '/account',
  '/settings',
  '/trial-ended',
  '/dashboard',
  '/sites/00000000-0000-4000-8000-000000000000',
  '/alerts',
  '/changes',
  '/competitors',
  '/billing',
  '/seats',
  '/agency',
  '/agency-trial',
  '/invite',
  '/internal',
  '/unsubscribe',
  '/reports',
  '/audit/00000000-0000-4000-8000-000000000000',
  '/verify/00000000-0000-4000-8000-000000000000',
  '/s/view',
];

/** Route folders and what each is: an app surface (asked above), public, or not a page. */
export const ROUTE_FOLDERS: Readonly<
  Record<string, 'app' | 'public' | 'not-a-page' | 'page-controlled'>
> = {
  '(account)': 'app',
  agency: 'app',
  'agency-trial': 'app',
  alerts: 'app',
  audit: 'app',
  billing: 'app',
  changes: 'app',
  competitors: 'app',
  dashboard: 'app',
  internal: 'app',
  invite: 'app',
  login: 'app',
  reports: 'app',
  s: 'app',
  seats: 'app',
  sites: 'app',
  unsubscribe: 'app',
  verify: 'app',
  agencies: 'public',
  'ai-readiness-checker': 'public',
  aup: 'public',
  authors: 'public',
  blog: 'public',
  bot: 'public',
  check: 'public',
  developers: 'public',
  guides: 'public',
  help: 'public',
  pricing: 'public',
  privacy: 'public',
  status: 'public',
  subprocessors: 'public',
  takedown: 'public',
  terms: 'public',
  // Indexing decided by the page itself (§13: unclaimed reports, thin boards, compare pages).
  r: 'page-controlled',
  top: 'page-controlled',
  compare: 'page-controlled',
  // Not pages a search engine lists: handlers, images, embeds, rewrite targets, previews.
  api: 'not-a-page',
  embed: 'not-a-page',
  ingest: 'not-a-page',
  og: 'not-a-page',
  'llms.txt': 'not-a-page',
  'robots.txt': 'not-a-page',
  'v2-home': 'not-a-page',
  'v2-pricing': 'not-a-page',
  'v2-developers': 'not-a-page',
  'v2-report': 'not-a-page',
  '(v2-kept)': 'not-a-page',
  '(v2-preview)': 'not-a-page',
};
