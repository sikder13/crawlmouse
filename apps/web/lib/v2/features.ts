/**
 * The Goal 1 switch's answer as a plain record, for the views, copy modules and components that hide
 * what it hides. Only a server entry point reads the switch (`shownFeatures()` in
 * `lib/feature-switch.ts`, which imports 'server-only') and passes the record down; this module
 * imports that file's type alone, so a client component may import it.
 */
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
