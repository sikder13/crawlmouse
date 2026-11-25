/**
 * The Goal 1 switch's answer as a plain record, for the views, copy modules and components that hide
 * what it hides. Only a server entry point reads the switch (`shownFeatures()` in
 * `lib/feature-switch.ts`, which imports 'server-only') and passes the record down; this module
 * imports that file's type alone, so a client component may import it.
 */
import type { FixType } from '@crawlmouse/types/v2';
import type { RiskFeature } from '../feature-switch';

/** Which Goal 1 features may be named: true is shown. */
export type Features = Readonly<Record<RiskFeature, boolean>>;

/** Nothing hidden: what a caller that passes no record gets, and what the pages show today. */
export const ALL_SHOWN: Features = Object.freeze({
  ai_letter: true,
  nojs: true,
  pages_2000: true,
  rendering: true,
  competitors: true,
  staging_deploys: true,
  sentinel: true,
  agency_white_label: true,
  agency_domain: true,
});

/**
 * The fix types that are without-JavaScript findings: a template empty until scripts run, and links a
 * page adds only through JavaScript. With `nojs` hidden the /agencies one-pager lists no fix of these
 * types (`view/agencies.ts`); a minted report does not read the switch.
 */
export const NOJS_FIX_TYPES: ReadonlySet<FixType> = new Set<FixType>([
  'client_rendered_template',
  'js_only_navigation',
]);
