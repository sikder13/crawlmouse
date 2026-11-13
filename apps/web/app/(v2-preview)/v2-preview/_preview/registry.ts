/**
 * Every v2 preview page. The index page links these, the visual harness screenshots these, and a
 * test fails if a page exists that is not listed here or an entry has no page.
 */
export interface PreviewEntry {
  path: string;
  name: string;
  kind: 'primitive' | 'screen';
  /**
   * For a screen that changes as a recording plays: the moments the visual harness opens it at,
   * as query strings, each with the number of orange elements it shows then (rule 3).
   */
  moments?: { name: string; query: string; orange: 0 | 1 }[];
  /** A screen with no action for the reader shows no orange element; one otherwise. */
  orange?: 0 | 1;
}

export const PREVIEWS: PreviewEntry[] = [
  { path: '/v2-preview/button', name: 'Button', kind: 'primitive' },
  { path: '/v2-preview/status-pill', name: 'StatusPill', kind: 'primitive' },
  { path: '/v2-preview/grade', name: 'Grade', kind: 'primitive' },
  { path: '/v2-preview/verdict-cell', name: 'VerdictCell', kind: 'primitive' },
  { path: '/v2-preview/coverage-line', name: 'CoverageLine', kind: 'primitive' },
  { path: '/v2-preview/card', name: 'Card', kind: 'primitive' },
  { path: '/v2-preview/table', name: 'Table', kind: 'primitive' },
  { path: '/v2-preview/field', name: 'Field', kind: 'primitive' },
  { path: '/v2-preview/select', name: 'Select', kind: 'primitive' },
  { path: '/v2-preview/switch', name: 'Switch', kind: 'primitive' },
  { path: '/v2-preview/page-shell', name: 'PageShell', kind: 'primitive' },
  { path: '/v2-preview/account-shell', name: 'AccountShell', kind: 'primitive' },
  { path: '/v2-preview/trial-card', name: 'TrialCard', kind: 'primitive' },
  { path: '/v2-preview/theme-control', name: 'ThemeControl', kind: 'primitive' },
  { path: '/v2-preview/grade-history', name: 'GradeHistory', kind: 'primitive' },
  { path: '/v2-preview/check-glyph-row', name: 'CheckGlyphRow', kind: 'primitive' },
  { path: '/v2-preview/screens/home', name: 'Final-Home', kind: 'screen' },
  {
    path: '/v2-preview/screens/crawl',
    name: 'Final-Crawl',
    kind: 'screen',
    moments: [
      { name: '0-47', query: '?at=47000', orange: 0 },
      { name: '2-08', query: '?at=128000', orange: 0 },
      { name: 'end', query: '?at=end', orange: 1 },
    ],
  },
  {
    path: '/v2-preview/screens/crawl/clean',
    name: 'Crawl, clean re-run',
    kind: 'screen',
    moments: [{ name: 'now', query: '?at=end', orange: 0 }],
  },
  {
    path: '/v2-preview/screens/crawl/challenged',
    name: 'Crawl, challenged',
    kind: 'screen',
    moments: [{ name: 'end', query: '?at=end', orange: 1 }],
  },
  { path: '/v2-preview/screens/result', name: 'Final-Result', kind: 'screen' },
  { path: '/v2-preview/screens/result/clean', name: 'Result, clean bill', kind: 'screen' },
  { path: '/v2-preview/screens/result/challenged', name: 'Result, withheld', kind: 'screen' },
  {
    path: '/v2-preview/screens/result/loading',
    name: 'Result, loading',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/result/empty', name: 'Result, not started', kind: 'screen' },
  { path: '/v2-preview/screens/result/error', name: 'Result, failed', kind: 'screen' },
  { path: '/v2-preview/screens/result/expired', name: 'Result, expired', kind: 'screen' },
  { path: '/v2-preview/screens/segment/access', name: 'Final-Segment', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/access/clean',
    name: 'Crawler access, clean bill',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/segment/access/challenged',
    name: 'Crawler access, withheld',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/segment/nojs', name: 'Final-Seg-JS', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/nojs/clean',
    name: 'Without JavaScript, clean bill',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/segment/nojs/challenged',
    name: 'Without JavaScript, withheld',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/segment/structure', name: 'Final-Seg-Structure', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/structure/clean',
    name: 'Structure, clean bill',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/segment/structure/challenged',
    name: 'Structure, withheld',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/segment/content', name: 'Final-Seg-Content', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/content/clean',
    name: 'Content, clean bill',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/segment/content/challenged',
    name: 'Content, withheld',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/segment/signals', name: 'Final-Seg-Signals', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/signals/clean',
    name: 'Signals, clean bill',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/segment/signals/challenged',
    name: 'Signals, withheld',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/segment/changes', name: 'Final-Seg-Changes', kind: 'screen' },
  {
    path: '/v2-preview/screens/segment/changes/clean',
    name: 'Changes, clean bill',
    kind: 'screen',
  },
  // An account keeps the challenged site: no keep bar, and nothing on the page to act on.
  {
    path: '/v2-preview/screens/segment/changes/challenged',
    name: 'Changes, withheld',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/segment/changes/history',
    name: 'Changes, after a re-check',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/segment/changes/challenged-history',
    name: 'Changes, withheld, after a re-check',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/fix', name: 'Final-Fix', kind: 'screen' },
  { path: '/v2-preview/screens/fix/first', name: 'Fix 1, bad site', kind: 'screen' },
  { path: '/v2-preview/screens/fix/third', name: 'Fix 3, bad site', kind: 'screen' },
  { path: '/v2-preview/screens/fix/challenged', name: 'Fix, challenged site', kind: 'screen' },
  // Behind the Pro wall the keep bar's button is the orange element.
  { path: '/v2-preview/screens/fix/locked', name: 'Fix, on Pro', kind: 'screen' },
  // A kept site's resolved fix: nothing on the page to act on.
  { path: '/v2-preview/screens/fix/resolved', name: 'Fix, resolved', kind: 'screen', orange: 0 },
  { path: '/v2-preview/screens/dashboard/day0', name: 'Final-Dashboard-Day0', kind: 'screen' },
  { path: '/v2-preview/screens/dashboard', name: 'Final-Dashboard', kind: 'screen' },
  {
    path: '/v2-preview/screens/dashboard/clean',
    name: 'Dashboard, clean (stand-in Free account, H5)',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/dashboard/withheld', name: 'Dashboard, withheld', kind: 'screen' },
  { path: '/v2-preview/screens/site', name: 'Final-Site', kind: 'screen' },
  {
    path: '/v2-preview/screens/site/clean',
    name: 'Site, clean (stand-in Free account)',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/site/withheld', name: 'Site, withheld', kind: 'screen' },
  { path: '/v2-preview/screens/dashboard/no-site', name: 'Dashboard, no site', kind: 'screen' },
  {
    path: '/v2-preview/screens/site/first-check',
    name: 'Site, first check running',
    kind: 'screen',
  },
  // A sign-in the viewer cannot place on one account: nothing to act on.
  {
    path: '/v2-preview/screens/dashboard/no-account',
    name: 'Dashboard, no account',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/dashboard/ambiguous',
    name: 'Dashboard, more than one account',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/alerts', name: 'Final-Alerts', kind: 'screen' },
  // The stand-in Free account has sent nothing, so there is no open fix to act on.
  { path: '/v2-preview/screens/alerts/free', name: 'Alerts, free', kind: 'screen', orange: 0 },
  { path: '/v2-preview/screens/reports', name: 'Final-Reports', kind: 'screen' },
  {
    path: '/v2-preview/screens/reports/agency',
    name: 'Reports, Agency (Northwind, owner ruling 8)',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/settings', name: 'Final-Settings', kind: 'screen' },
  { path: '/v2-preview/screens/settings/free', name: 'Settings, free', kind: 'screen' },
  // Its one action deletes, which the Settings artboard draws quiet, never as the best action.
  {
    path: '/v2-preview/screens/settings/delete',
    name: 'Settings, delete (owner ruling 12)',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/trial-end', name: 'Final-TrialEnd', kind: 'screen' },
  // The account Changes log has no artboard (CC-27 D3), and nothing on it is the reader's action.
  {
    path: '/v2-preview/screens/changes-log',
    name: 'Changes log',
    kind: 'screen',
    moments: [
      { name: 'all', query: '', orange: 0 },
      { name: 'opened', query: '?kind=opened', orange: 0 },
    ],
  },
  { path: '/v2-preview/screens/map', name: 'Final-LinkMap', kind: 'screen' },
  { path: '/v2-preview/screens/map/all', name: 'Link map, every page', kind: 'screen' },
  // No fix to open from any page: the keep bar's button is the orange element.
  { path: '/v2-preview/screens/map/clean', name: 'Link map, clean bill', kind: 'screen' },
  // A kept site whose record holds no page: no fix link and no keep bar, so the link to the
  // section's fixes is the orange element (DESIGN-LOCK orange convention, the Next button).
  { path: '/v2-preview/screens/map/challenged', name: 'Link map, withheld', kind: 'screen' },
  { path: '/v2-preview/screens/map/large', name: 'Link map, 2,000 pages', kind: 'screen' },
  // CC-25, the account door. Sign-up's orange element is "Send my sign-in link"; Check-email
  // asks nothing of the reader but to open their inbox, so it has none (as locked).
  { path: '/v2-preview/screens/signup', name: 'Final-Signup', kind: 'screen' },
  { path: '/v2-preview/screens/signup/submitting', name: 'Sign-up, sending', kind: 'screen' },
  {
    path: '/v2-preview/screens/signup/rate-limited',
    name: 'Sign-up, rate limited',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/check-email/from-audit',
    name: 'Final-CheckEmail',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/check-email/named-site',
    name: 'Final-CheckEmail-NoAudit',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/check-email/signin',
    name: 'Check-email, sign-in',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/continue', name: 'Continue', kind: 'screen' },
  { path: '/v2-preview/screens/continue/expired', name: 'Continue, link expired', kind: 'screen' },
  // CC-29: Pricing's orange element is the Pro button (DESIGN-LOCK §6); signed in with the Pro trial
  // used, it is the Pro checkout. The Agency trial's is "Start a 14-day trial"; a used trial shows no
  // form and asks nothing of the reader.
  { path: '/v2-preview/screens/pricing', name: 'Final-Pricing', kind: 'screen' },
  { path: '/v2-preview/screens/pricing/signed-in', name: 'Pricing, signed in', kind: 'screen' },
  { path: '/v2-preview/screens/agency-trial', name: 'Final-AgencyTrial', kind: 'screen' },
  {
    path: '/v2-preview/screens/agency-trial/returning',
    name: 'Agency trial, Checkout did not finish',
    kind: 'screen',
  },
  {
    path: '/v2-preview/screens/agency-trial/used',
    name: 'Agency trial, used',
    kind: 'screen',
    orange: 0,
  },
  {
    path: '/v2-preview/screens/agency-trial/held',
    name: 'Agency trial, on the trial: its billing and Cancel',
    kind: 'screen',
    orange: 0,
  },
  // CC-29 workstream C. For agencies' orange element is the trial button; Developers' is the
  // closing audit's button. The /check pages have no artboard: each is the Home screen's parts,
  // with the hero form's button orange.
  { path: '/v2-preview/screens/agencies', name: 'Final-Agencies', kind: 'screen' },
  { path: '/v2-preview/screens/developers', name: 'Final-Developers', kind: 'screen' },
  { path: '/v2-preview/screens/check/gptbot', name: 'Check: is GPTBot blocked?', kind: 'screen' },
  {
    path: '/v2-preview/screens/check/javascript',
    name: 'Check: readable without JavaScript?',
    kind: 'screen',
  },
  { path: '/v2-preview/screens/check/robots-ai', name: 'Check: robots.txt for AI', kind: 'screen' },
  // CC-29 workstream B: the shared report. Its orange element is the audit form's "Start the audit".
  { path: '/v2-preview/screens/public-report', name: 'Final-Public', kind: 'screen' },
  {
    path: '/v2-preview/screens/public-report/withheld',
    name: 'Public report, withheld',
    kind: 'screen',
  },
];
