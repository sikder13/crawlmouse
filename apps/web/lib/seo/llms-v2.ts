/**
 * /llms.txt's key pages while V2_CHECKS_PUBLIC is on: [label, path, description] for the public
 * pages listed below, the label and description being the page's own title and meta description,
 * read from where its metadata reads them; /developers is labelled by its short name, because its
 * indexed title lists tools that are not shipped. With both V2_CHECKS_PUBLIC and V2_BILLING off, /pricing and
 * /developers are v1's pages and are listed with v1's own metadata.
 */
import type { Metadata } from 'next';
import { accountDoorEnabled, v2PublicPagesEnabled } from '../auth/flags';
import { billingPublic } from '../billing/flags';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, PRO_YEARLY, usd } from '../billing/prices';
import { DEVELOPERS_COPY } from '../v2/copy/developers';
import { PRICING_COPY } from '../v2/copy/pricing';
import { CHECK_COPY, CHECK_QUESTIONS, checkPath } from '../v2/copy/check-pages';
import { HELP_COPY } from '../v2/help/copy';
import { agenciesView } from '../v2/view/agencies';
import { metadata as v1Pricing } from '../../app/pricing/page';
import { metadata as v1Developers } from '../../app/developers/page';
import { metadata as blog } from '../../app/blog/page';
import { metadata as guides } from '../../app/guides/page';
import { metadata as bot } from '../../app/bot/page';
import { metadata as aiReadiness } from '../../app/ai-readiness-checker/AiReadinessChecker';
import { V2_HOME_DESCRIPTION, V2_HOME_TITLE } from './site-copy';

export type KeyPage = readonly [label: string, path: string, description: string];

/** A page's title as text: `title.absolute`, or the plain string. */
function titleOf(m: Pick<Metadata, 'title'>): string {
  const t = m.title;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && 'absolute' in t && typeof t.absolute === 'string')
    return t.absolute;
  throw new Error('a key page needs a title');
}

function fromMetadata(path: string, m: Pick<Metadata, 'title' | 'description'>): KeyPage {
  if (typeof m.description !== 'string') throw new Error(`${path} needs a description`);
  return [titleOf(m), path, m.description];
}

export function v2KeyPages(): KeyPage[] {
  // RC-01: /pricing and /developers are the v2 pages while either flag is on.
  const v2Served = v2PublicPagesEnabled();
  const agencies = agenciesView({
    billing: billingPublic(),
    accountDoor: accountDoorEnabled(),
  });
  return [
    [V2_HOME_TITLE, '/', V2_HOME_DESCRIPTION],
    v2Served
      ? [PRICING_COPY.pageTitle, '/pricing', PRICING_COPY.description()]
      : fromMetadata('/pricing', v1Pricing),
    [agencies.title, '/agencies', agencies.description],
    v2Served
      ? [DEVELOPERS_COPY.navLabel, '/developers', DEVELOPERS_COPY.description]
      : fromMetadata('/developers', v1Developers),
    ...CHECK_QUESTIONS.map(
      (q): KeyPage => [CHECK_COPY[q].title, checkPath(q), CHECK_COPY[q].description],
    ),
    [HELP_COPY.title, '/help', HELP_COPY.description],
    fromMetadata('/ai-readiness-checker', aiReadiness),
    fromMetadata('/blog', blog),
    fromMetadata('/guides', guides),
    fromMetadata('/bot', bot),
  ];
}

/**
 * The plans on sale and their prices, one line, from lib/billing/prices.ts: the plans
 * SoftwareApplication offers (Agency while V2_BILLING sells it).
 */
export function plansLine(): string {
  const plans = [
    'Free',
    `Pro ${usd(PRO_MONTHLY)}/month or ${usd(PRO_YEARLY)}/year`,
    ...(billingPublic()
      ? [`Agency ${usd(AGENCY_MONTHLY)}/month or ${usd(AGENCY_YEARLY)}/year`]
      : []),
  ];
  return `Plans: ${plans.join('; ')}.`;
}
