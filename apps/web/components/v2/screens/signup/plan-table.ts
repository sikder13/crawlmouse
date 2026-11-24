/**
 * Sign-up's plan table and its footer line, built from GATES, TRIAL_DAYS and the prices, and
 * following the Goal 1 switch and Agency's sale. Each phrase that names a capability carries it, and
 * `CAPABILITIES[key].risk` (lib/v2/view/agencies.ts) names the switch that hides it, as on Pricing;
 * the page limit is Pricing's `planPages`. The Sign-up page reads the switch and the flags and
 * passes them in as plain values; this module reads neither.
 *
 * Kept apart from door-copy.ts, which client components import: this one reaches the capability
 * table, and only the server-rendered Sign-up screen imports it.
 */
import { GATES } from '@/lib/entitlement-v2';
import { TRIAL_DAYS } from '@/lib/billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '@/lib/billing/prices';
import type { Tagged } from '@/lib/v2/copy/agencies';
import { PRICING_COPY, planPages } from '@/lib/v2/copy/pricing';
import { ALL_SHOWN, type Features } from '@/lib/v2/features';
import { isHidden, shown, taggedWith } from '@/lib/v2/view/agencies';
import { count, numberWord } from '@/lib/v2/words';
import { cadenceOf, cap, trialDays } from './door-copy';

export interface PlanGroup {
  heading: string;
  plan: string;
  rows: { what: string; value: string }[];
}

/** The phrases the switch shows, joined into one row. */
const row = (features: Features, phrases: Tagged[]) =>
  shown(phrases.map(taggedWith(features)))
    .map((t) => t.text)
    .join(', ');

/**
 * The Sign-up card's table: what Free always includes, and what Pro adds for the trial. A Pro row
 * whose every phrase is hidden is left out.
 */
export function planGroups(features: Features = ALL_SHOWN): PlanGroup[] {
  const free = GATES.free;
  const pro = GATES.pro;
  if (free.fixesVisible === 'all' || pro.fixesVisible !== 'all') {
    throw new Error('the plan table assumes Free shows some fixes and Pro shows all');
  }
  const pages = planPages('pro', features.pages_2000);
  const proChecks = row(features, [
    { text: `${cap(cadenceOf('pro'))} checks`, capabilities: ['weekly_checks'] },
    ...(pro.slack ? [{ text: 'alerts to Slack', capabilities: ['slack_alerts'] } as Tagged] : []),
    { text: `up to ${pro.sites} sites`, capabilities: ['sites'] },
    ...(pages === null ? [] : [{ text: `up to ${pages} a site`, capabilities: [] } as Tagged]),
  ]);
  const proExtras = cap(
    row(features, [
      {
        text: `${numberWord(pro.competitorsPerSite)} competitor${pro.competitorsPerSite === 1 ? '' : 's'}`,
        capabilities: ['competitors'],
      },
      ...(pro.exports
        ? [{ text: 'PDF, CSV and JSON export', capabilities: ['exports'] } as Tagged]
        : []),
      ...(pro.stagingAndDeployHooks
        ? [{ text: 'staging audits', capabilities: ['staging'] } as Tagged]
        : []),
    ]),
  );
  return [
    {
      heading: 'Always',
      plan: 'Free',
      rows: [
        `${cap(numberWord(free.sites))} site, up to ${count(free.pagesPerCheck)} pages, re-checked ${cadenceOf('free')}`,
        'An email only if a check finds a change',
        `${cap(numberWord(free.fixesVisible))} complete fixes per audit, with packets`,
        'Every audit, its evidence and link map, kept',
      ].map((what) => ({ what, value: 'yes' })),
    },
    {
      heading: `For ${trialDays}`,
      plan: 'Pro',
      rows: ['Every fix with copy-paste packets', proChecks, proExtras]
        .filter((what) => what !== '')
        .map((what) => ({ what, value: trialDays })),
    },
  ];
}

/**
 * The line under the table. "under your brand" names the client report page, which either agency
 * switch hides. `agencyOpen` false (Agency not on sale): no trial and no card, and the plan opens.
 */
export function planFootnote(features: Features = ALL_SHOWN, agencyOpen = true): string {
  const brand = isHidden(['client_report_page'], features) ? '' : ' under your brand';
  return (
    `After ${trialDays} the account is Free. Pro is ${usd(PRO_MONTHLY)} a month only if you choose ` +
    `it. Agencies: ${GATES.agency.sites} sites${brand}, ${usd(AGENCY_MONTHLY)} a month` +
    (agencyOpen
      ? `, ${TRIAL_DAYS}-day trial with a card.`
      : `. ${PRICING_COPY.buttons.agencyStartFree.note}.`)
  );
}
