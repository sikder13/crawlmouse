/**
 * Pricing (Final-Pricing, CC-29 D2) as data: the three plans on the chosen interval, the Agency Plus
 * row, and each plan's button for this viewer. Pure: the page reads the viewer (lib/v2/pricing/read.ts)
 * and passes it in.
 *
 * The buttons follow the viewer. Signed out, Free and Pro go to Sign-up (one email creates the
 * account and starts the Pro trial) and Agency to the Agency trial page. Signed in, the default
 * account's tier is "Your plan"; Pro offers its trial only when the state machine's `trialRefusal`
 * says the account may start one, and the paid checkout otherwise; Agency is "Your plan" when one of
 * the viewer's agency accounts is on Agency, the paid checkout on the account whose trial was used
 * (a person has one agency trial), and the trial otherwise. Only the account's owner changes its plan.
 * The one orange button (DESIGN-LOCK rule 3) is the first of Pro, Agency and Free that is a button.
 */
import type { Interval } from '../../billing/catalog';
import { usd } from '../../billing/prices';
import { trialRefusal, type EntitlementSnapshot } from '../../billing/state-machine';
import type { Tier } from '../../entitlement-v2';
import { agencyTrialPath } from './agency-trial';
import { PRICING_COPY as COPY, per, planCopy, priceOf, type PlanRow } from '../copy/pricing';

export type PricingViewer =
  | { kind: 'signed_out' }
  | {
      kind: 'signed_in';
      /**
       * The viewer's default account: its id, whether the viewer owns it, its tier now, and its
       * entitlement as the state machine reads it. Null when the viewer has no account, or several
       * and no default.
       */
      account: { id: string; owner: boolean; tier: Tier; snapshot: EntitlementSnapshot } | null;
      agency: {
        /** One of the viewer's agency accounts is on Agency now (paid, trial or grace). */
        held: boolean;
        /** An agency account the viewer owns whose trial was used, or null. */
        trialUsedAccountId: string | null;
      };
    };

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
  description: string;
  rows: PlanRow[];
  action: PlanAction;
}

export interface PricingView {
  title: string;
  lead: string;
  interval: Interval;
  intervals: { interval: Interval; label: string; href: string; current: boolean }[];
  plans: PlanView[];
  crawlers: string;
  annual: string;
  agencyPlus: { name: string; limits: string; price: string; link: string; formTitle: string };
  after: { title: string; lead: string; columns: readonly string[]; rows: [string, string][] };
  why: { title: string; text: string };
  faq: { title: string; items: { q: string; a: string }[] };
}

const PRO_TRIAL_START = '/api/billing/pro-trial/start';
const CHECKOUT = '/api/billing/checkout';
const SIGNUP = '/signup';

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

function freeAction(viewer: PricingViewer): Unranked {
  const account = viewer.kind === 'signed_in' ? viewer.account : null;
  if (account === null) return link(SIGNUP, COPY.buttons.free);
  if (account.tier === 'free') return { kind: 'current', ...COPY.buttons.current };
  return { kind: 'note', note: COPY.buttons.freeBelow.note };
}

function proAction(viewer: PricingViewer, interval: Interval, now: Date): Unranked {
  const trial = { label: COPY.buttons.proTrial.label, note: COPY.buttons.proTrial.note(interval) };
  const account = viewer.kind === 'signed_in' ? viewer.account : null;
  if (account === null) return link(SIGNUP, trial);
  if (account.tier === 'pro') return { kind: 'current', ...COPY.buttons.current };
  if (account.tier === 'agency') return { kind: 'current', ...COPY.buttons.included };
  if (!account.owner) return { kind: 'note', note: COPY.buttons.notOwner.note };
  if (trialRefusal(account.snapshot, now) === null)
    return form(PRO_TRIAL_START, { accountId: account.id }, trial);
  return form(
    CHECKOUT,
    { plan: 'pro', interval, accountId: account.id },
    { label: COPY.buttons.proBuy.label, note: COPY.buttons.proBuy.note(interval) },
  );
}

function agencyAction(viewer: PricingViewer, interval: Interval): Unranked {
  const trial = link(agencyTrialPath(interval), COPY.buttons.agencyTrial);
  if (viewer.kind === 'signed_out') return trial;
  if (viewer.agency.held || viewer.account?.tier === 'agency') {
    return { kind: 'current', ...COPY.buttons.current };
  }
  const used = viewer.agency.trialUsedAccountId;
  if (used !== null) {
    return form(
      CHECKOUT,
      { plan: 'agency', interval, accountId: used },
      { label: COPY.buttons.agencyBuy.label, note: COPY.buttons.agencyBuy.note(interval) },
    );
  }
  return trial;
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

export function pricingView(viewer: PricingViewer, interval: Interval, now: Date): PricingView {
  const copy = planCopy(interval);
  const actions = ranked({
    free: freeAction(viewer),
    pro: proAction(viewer, interval, now),
    agency: agencyAction(viewer, interval),
  });
  const tiers: Tier[] = ['free', 'pro', 'agency'];
  return {
    title: COPY.title,
    lead: COPY.lead(),
    interval,
    intervals: (['month', 'year'] as const).map((i) => ({
      interval: i,
      label: COPY.intervals[i],
      href: pricingHref(i),
      current: i === interval,
    })),
    plans: tiers.map((tier) => ({
      tier,
      ...copy[tier],
      price: usd(priceOf(tier, interval)),
      per: per(interval),
      action: actions[tier],
    })),
    crawlers: COPY.crawlers,
    annual: COPY.annual(),
    agencyPlus: {
      name: COPY.agencyPlus.name,
      limits: COPY.agencyPlus.limits(),
      price: COPY.agencyPlus.price(),
      link: COPY.agencyPlus.link,
      formTitle: COPY.agencyPlus.formTitle,
    },
    after: {
      title: COPY.after.title,
      lead: COPY.after.lead(),
      columns: COPY.after.columns,
      rows: COPY.after.rows(interval),
    },
    why: COPY.why,
    faq: { title: COPY.faq.title, items: COPY.faq.items() },
  };
}

/** The interval a request asks for: `?interval=year`, else monthly. */
export function intervalFrom(value: string | string[] | undefined): Interval {
  return value === 'year' ? 'year' : 'month';
}
