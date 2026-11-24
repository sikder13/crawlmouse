/**
 * The switch for hiding a feature not yet proven (Goal 1, rule 2): at the deadline, a feature QA has
 * not proven is to be hidden wherever it is named, rather than shipped broken. This module is the one
 * place that switch is read from. It hides only what reads it: each page, screen and email that
 * names one of these features is wired to it in its owner's own change.
 *
 * `V2_HIDE_FEATURES` is a comma-separated list of the names in `RISK_FEATURES`, case and spaces
 * ignored. Unset or empty, every feature shows, as it does today. A name that is not a feature hides
 * nothing; `hiddenFeatures().unknown` lists it. Server-only: the variable is not NEXT_PUBLIC_, so a
 * client bundle would read it as unset and show everything. A server component hands a client one
 * `shownFeatures()`.
 */
import 'server-only';

type Env = Readonly<Record<string, string | undefined>>;

/** One name per RISK row of Goal 1, with the row it is. */
export const RISK_FEATURES = [
  'ai_letter', // 3: the AI readability letter
  'nojs', // 4: the without-JavaScript figures
  'pages_2000', // 16: 2,000 pages per check
  'rendering', // 17: full renders, 10 and 30 a month
  'competitors', // 18: competitors per site
  'staging_deploys', // 20: staging audited on each deploy
  'sentinel', // 23: the daily sentinel watch
  'agency_white_label', // 24: white-label audit, client page, matrix, scheduled reports
  'agency_domain', // 25: reports on the agency's own domain
] as const;

export type RiskFeature = (typeof RISK_FEATURES)[number];

const KNOWN: ReadonlySet<string> = new Set(RISK_FEATURES);

/** The features the variable hides, and the names in it that are no feature. */
export function hiddenFeatures(env: Env = process.env): {
  hidden: ReadonlySet<RiskFeature>;
  unknown: string[];
} {
  const names = (env.V2_HIDE_FEATURES ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  const hidden = new Set<RiskFeature>();
  const unknown: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (KNOWN.has(key)) hidden.add(key as RiskFeature);
    // Reported as written, once.
    else if (!unknown.includes(name)) unknown.push(name);
  }
  return { hidden, unknown };
}

/** Whether `feature` may be named or offered anywhere. */
export function featureShown(feature: RiskFeature, env: Env = process.env): boolean {
  return !hiddenFeatures(env).hidden.has(feature);
}

/** Every feature's state, as plain booleans a server component can pass to a client one. */
export function shownFeatures(env: Env = process.env): Record<RiskFeature, boolean> {
  const { hidden } = hiddenFeatures(env);
  return Object.fromEntries(RISK_FEATURES.map((f) => [f, !hidden.has(f)])) as Record<
    RiskFeature,
    boolean
  >;
}
