/**
 * Fixtures for the Pricing and Agency trial previews (CC-29): the views as the pages build them, for a
 * fixed moment, so the visual set does not move with the clock.
 */
import { FREE_START } from '../../../../lib/billing/state-machine';
import {
  agencyStanding,
  agencyTrialView,
  type AgencyAccountRow,
} from '../../../../lib/v2/view/agency-trial';
import type { UsedTrial } from '../../../../lib/v2/pricing/used-trial';
import { pricingView } from '../../../../lib/v2/view/pricing';

/** The fixture's dashboard sample day (FACTS: the trial ends Sun 8 Nov). */
const AT = new Date('2026-10-25T15:00:00Z');
const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';
/** The flags the pages' buttons are designed for: Sign-up and the Pro trial served. */
const FLAGS = { accountDoor: true, checksPublic: true };

/** Signed out: Free and Pro go to Sign-up, Agency to the Agency trial. */
export const pricingSignedOut = () => pricingView({ kind: 'signed_out' }, 'month', AT, FLAGS);

/** Signed in on a Free account whose Pro trial was used: Pro is the paid checkout. */
export const pricingSignedIn = () =>
  pricingView(
    {
      kind: 'signed_in',
      account: {
        id: ACCOUNT,
        owner: true,
        tier: 'free',
        snapshot: { ...FREE_START, trialUsedAt: new Date('2026-10-01T00:00:00Z') },
        customer: null,
      },
      agency: { held: false, used: null },
    },
    'year',
    AT,
    FLAGS,
  );

const agencyRow = (over: Partial<AgencyAccountRow>): AgencyAccountRow => ({
  id: 'a0000000-0000-4000-8000-00000000000b',
  role: 'owner',
  name: 'Summit Digital',
  state: 'free',
  tier: 'free',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  trialUsedAt: null,
  subscriptionId: null,
  billingEnd: null,
  firstSite: 'example-outfitter.com',
  ...over,
});

const trial = (
  rows: AgencyAccountRow[],
  used: UsedTrial | null = null,
  customers: ReadonlyMap<string, string | null> = new Map(),
) =>
  agencyTrialView(
    {
      email: 'owner@summitdigital.co',
      interval: 'month',
      timeZone: 'UTC',
      standing: agencyStanding(rows, used, AT),
      customers,
      cancelAsked: null,
    },
    AT,
  );

export const agencyTrialNew = () => trial([]);
export const agencyTrialReturning = () => trial([agencyRow({})]);
export const agencyTrialUsed = () => {
  const row = agencyRow({ trialUsedAt: new Date('2026-10-01T10:00:00Z') });
  return trial([row], { accountId: row.id, trialUsedAt: row.trialUsedAt!, deleted: false });
};

/** On the Agency trial: no form, the account's Manage billing and Cancel (Q26). */
export const agencyTrialHeld = () => {
  const row = agencyRow({
    state: 'agency_trial',
    tier: 'agency',
    trialVariant: 'card_required',
    trialEndsAt: new Date('2026-11-08T15:00:00Z'),
    trialUsedAt: new Date('2026-10-25T15:00:00Z'),
    subscriptionId: 'sub_preview',
  });
  return trial(
    [row],
    { accountId: row.id, trialUsedAt: row.trialUsedAt!, deleted: false },
    new Map([[row.id, 'cus_preview']]),
  );
};
