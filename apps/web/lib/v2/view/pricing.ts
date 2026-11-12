/**
 * Pricing (Final-Pricing, CC-29 D2) as data: the three plans on the chosen interval, the Agency Plus
 * row, and each plan's button for this viewer. Pure: the page reads the viewer (lib/v2/pricing/read.ts)
 * and the flags, and passes them in.
 *
 * A button is offered only where the route it reaches would act (correctness B2, Q24):
 * - Signed out, Free and Pro go to Sign-up (one email creates the account and starts the Pro trial)
 *   while V2_ACCOUNT_DOOR serves it, and to v1's sign-in (`/login`) otherwise; Agency goes to the
 *   Agency trial page.
 * - Signed in, the default account's tier is "Your plan", and only the account's owner changes it.
 *   Pro offers its trial when `trialRefusal` lets the account start one and V2_CHECKS_PUBLIC serves
 *   the trial's route. Otherwise a paid plan is decided by CC-03's `checkoutRefusal`: no refusal is
 *   the checkout; `subscription_open` is the billing portal for that account, when `portalRefusal`
 *   lets it open; any other refusal is no button.
 * - Agency is "Your plan" when one of the viewer's agency accounts is on Agency; on the agency
 *   account whose trial was used (one trial a person), the paid plan as above; otherwise the trial.
 * The one orange button (DESIGN-LOCK rule 3) is the first of Pro, Agency and Free that is a button.
 */
import type { Interval } from '../../billing/catalog';
import { checkoutRefusal } from '../../billing/checkout-refusal';
import { portalRefusal } from '../../billing/portal-v2';
import { usd } from '../../billing/prices';
import { trialRefusal, type EntitlementSnapshot } from '../../billing/state-machine';
import type { PaidTier, Tier } from '../../entitlement-v2';
import { AGENCIES_COPY } from '../copy/agencies';
import { tagged, type TaggedView } from './agencies';
import { agencyTrialPath } from './agency-trial';
import { PRICING_COPY as COPY, per, planCopy, priceOf, type PlanRow } from '../copy/pricing';

/** An account a paid button may act on, as CC-03's refusals read it. */
export interface PricingAccount {
  id: string;
  snapshot: EntitlementSnapshot;
  /** The account's Stripe customer, which the portal needs; null when Stripe does not know it. */
  customer: string | null;
}

export type PricingViewer =
  | { kind: 'signed_out' }
  | {
      kind: 'signed_in';
      /**
       * The viewer's default account: whether the viewer owns it and its tier now, besides what the
       * refusals read. Null when the viewer has no account, or several and no default.
       */
      account: (PricingAccount & { owner: boolean; tier: Tier }) | null;
      agency: {
        /** One of the viewer's agency accounts is on Agency now (paid, trial or grace). */
        held: boolean;
        /**
         * The viewer's agency trial is used (lib/v2/pricing/used-trial.ts); `account` is that owned
         * agency account, null when it is deleted. Null when no trial is used.
         */
        used: { account: PricingAccount | null } | null;
      };
    };

/** The flags the buttons' routes are served under: V2_ACCOUNT_DOOR and V2_CHECKS_PUBLIC. */
export interface PricingFlags {
  accountDoor: boolean;
  checksPublic: boolean;
}

interface ActionText {
  label: string;
  note: string;
}

export type PlanAction =
  | (ActionText & { kind: 'link'; href: string; primary: boolean })
  | (ActionText & {
      kind: 'form';
      action: string;
      fields: Readonly<Record<string, string>>;
      primary: boolean;
    })
  /** Not a button: the plan the account is on, or one it already includes. */
  | (ActionText & { kind: 'current' })
  /** Not a button and no label: a sentence where a button would be. */
  | { kind: 'note'; note: string };

export interface PlanView {
  tier: Tier;
  name: string;
  tag: string;
  price: string;
  per: string;
  description: TaggedView;
  rows: (TaggedView & Pick<PlanRow, 'label'>)[];
  action: PlanAction;
}

/**
 * Every sentence that names a capability is a `TaggedView` (For agencies' table): the page marks it
 * "coming" (`comingLabel`) when one of its capabilities is not built.
 */
export interface PricingView {
  title: string;
  lead: TaggedView[];
  interval: Interval;
  intervals: { interval: Interval; label: string; href: string; current: boolean }[];
  plans: PlanView[];
  crawlers: TaggedView[];
  annual: TaggedView[];
  agencyPlus: {
    name: string;
    limits: TaggedView;
    price: string;
    link: string;
    formTitle: string;
    reply: TaggedView;
  };
  after: {
    title: string;
    lead: TaggedView[];
    columns: readonly string[];
    rows: [string, TaggedView][];
  };
  why: { title: string; text: TaggedView[] };
  faq: { title: string; items: { q: string; a: TaggedView }[] };
  comingLabel: string;
}

const PRO_TRIAL_START = '/api/billing/pro-trial/start';
const CHECKOUT = '/api/billing/checkout';
const PORTAL = '/api/billing/portal';
const SIGNUP = '/signup';
/** v1's sign-in, which creates the account on a first sign-in. */
const LOGIN = '/login';

const pricingHref = (interval: Interval) =>
  interval === 'month' ? '/pricing' : '/pricing?interval=year';

type Unranked =
  | Omit<Extract<PlanAction, { kind: 'link' }>, 'primary'>
  | Omit<Extract<PlanAction, { kind: 'form' }>, 'primary'>
  | Extract<PlanAction, { kind: 'current' | 'note' }>;

const link = (href: string, text: ActionText): Unranked => ({ kind: 'link', href, ...text });
const form = (action: string, fields: Record<string, string>, text: ActionText): Unranked => ({
  kind: 'form',
  action,
  fields,
  ...text,
});

/**
 * The paid button for `plan` on `account`: CC-03's checkout when `checkoutRefusal` lets it, the
 * account's billing portal when the refusal is `subscription_open` and `portalRefusal` lets it
 * open, and otherwise no button.
 */
function paidAction(
  account: PricingAccount,
  plan: PaidTier,
  interval: Interval,
  text: ActionText,
): Unranked {
  const refusal = checkoutRefusal(account.snapshot, plan);
  if (refusal === null) return form(CHECKOUT, { plan, interval, accountId: account.id }, text);
  if (refusal.error === 'subscription_open' && portalRefusal(account.customer) === null) {
    return form(PORTAL, { accountId: account.id }, COPY.buttons.portal);
  }
  return { kind: 'note', note: COPY.buttons.unavailable.note };
}

function freeAction(viewer: PricingViewer, flags: PricingFlags): Unranked {
  const account = viewer.kind === 'signed_in' ? viewer.account : null;
  if (account === null) {
    return flags.accountDoor
      ? link(SIGNUP, COPY.buttons.free)
      : link(LOGIN, COPY.buttons.freeSignIn);
  }
  if (account.tier === 'free') return { kind: 'current', ...COPY.buttons.current };
  return { kind: 'note', note: COPY.buttons.freeBelow.note };
}

function proAction(
  viewer: PricingViewer,
  interval: Interval,
  now: Date,
  flags: PricingFlags,
): Unranked {
  const trial = { label: COPY.buttons.proTrial.label, note: COPY.buttons.proTrial.note(interval) };
  const account = viewer.kind === 'signed_in' ? viewer.account : null;
  if (account === null) {
    return flags.accountDoor
      ? link(SIGNUP, trial)
      : link(LOGIN, {
          label: COPY.buttons.proSignIn.label,
          note: COPY.buttons.proSignIn.note(interval),
        });
  }
  if (account.tier === 'pro') return { kind: 'current', ...COPY.buttons.current };
  if (account.tier === 'agency') return { kind: 'current', ...COPY.buttons.included };
  if (!account.owner) return { kind: 'note', note: COPY.buttons.notOwner.note };
  if (flags.checksPublic && trialRefusal(account.snapshot, now) === null) {
    return form(PRO_TRIAL_START, { accountId: account.id }, trial);
  }
  return paidAction(account, 'pro', interval, {
    label: COPY.buttons.proBuy.label,
    note: COPY.buttons.proBuy.note(interval),
  });
}

function agencyAction(viewer: PricingViewer, interval: Interval): Unranked {
  const trial = link(agencyTrialPath(interval), COPY.buttons.agencyTrial);
  if (viewer.kind === 'signed_out') return trial;
  if (viewer.agency.held || viewer.account?.tier === 'agency') {
    return { kind: 'current', ...COPY.buttons.current };
  }
  const used = viewer.agency.used;
  if (used === null) return trial;
  if (used.account === null) return { kind: 'note', note: COPY.buttons.agencyUsed.note };
  return paidAction(used.account, 'agency', interval, {
    label: COPY.buttons.agencyBuy.label,
    note: COPY.buttons.agencyBuy.note(interval),
  });
}

/** The first actionable of Pro, Agency and Free carries the orange; the rest are default buttons. */
function ranked(actions: Record<Tier, Unranked>): Record<Tier, PlanAction> {
  const order: Tier[] = ['pro', 'agency', 'free'];
  const first = order.find((t) => actions[t].kind === 'link' || actions[t].kind === 'form');
  const out = {} as Record<Tier, PlanAction>;
  for (const tier of order) {
    const a = actions[tier];
    out[tier] = a.kind === 'link' || a.kind === 'form' ? { ...a, primary: tier === first } : a;
  }
  return out;
}

export function pricingView(
  viewer: PricingViewer,
  interval: Interval,
  now: Date,
  flags: PricingFlags,
): PricingView {
  const copy = planCopy(interval);
  const actions = ranked({
    free: freeAction(viewer, flags),
    pro: proAction(viewer, interval, now, flags),
    agency: agencyAction(viewer, interval),
  });
  const tiers: Tier[] = ['free', 'pro', 'agency'];
  return {
    title: COPY.title,
    lead: COPY.lead().map(tagged),
    interval,
    intervals: (['month', 'year'] as const).map((i) => ({
      interval: i,
      label: COPY.intervals[i],
      href: pricingHref(i),
      current: i === interval,
    })),
    plans: tiers.map((tier) => ({
      tier,
      name: copy[tier].name,
      tag: copy[tier].tag,
      description: tagged(copy[tier].description),
      rows: copy[tier].rows.map((r) => ({ label: r.label, ...tagged(r) })),
      price: usd(priceOf(tier, interval)),
      per: per(interval),
      action: actions[tier],
    })),
    crawlers: COPY.crawlers().map(tagged),
    annual: COPY.annual().map(tagged),
    agencyPlus: {
      name: COPY.agencyPlus.name,
      limits: tagged({ text: COPY.agencyPlus.limits(), capabilities: ['sites', 'seats'] }),
      price: COPY.agencyPlus.price(),
      link: COPY.agencyPlus.link,
      formTitle: COPY.agencyPlus.formTitle,
      reply: tagged(COPY.agencyPlus.reply),
    },
    after: {
      title: COPY.after.title,
      lead: COPY.after.lead().map(tagged),
      columns: COPY.after.columns,
      rows: COPY.after.rows(interval).map(([what, happens]) => [what, tagged(happens)]),
    },
    why: { title: COPY.why.title, text: COPY.why.text().map(tagged) },
    faq: {
      title: COPY.faq.title,
      items: COPY.faq.items().map(({ q, a }) => ({ q, a: tagged(a) })),
    },
    comingLabel: AGENCIES_COPY.coming,
  };
}

/** The interval a request asks for: `?interval=year`, else monthly. */
export function intervalFrom(value: string | string[] | undefined): Interval {
  return value === 'year' ? 'year' : 'month';
}
