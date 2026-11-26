/**
 * For agencies as data (CC-29 D4): the artboard's copy with its prices from `prices.ts`, its limits
 * from `GATES`, and its one-pager preview from the bad-site fixture's first audit through
 * `buildPublicSnapshot`, the builder the public report uses.
 *
 * `CAPABILITIES` (kept in `capabilities.ts`, re-exported here) is the table of every capability the
 * pages that sell name (For agencies, Pricing and the Agency trial page), with whether it is on main
 * and the proof of it. A built capability's proof is the file that does it. A coming one's proof is
 * something `agencies.test.ts` checks against the tree: the file its step will add is absent, a pattern the code that would do it has to contain is
 * nowhere in the source, or the code that would do it says it does not yet, or all of several such.
 * Each proof fails when its step adds that file or that text; a step that ships the capability some
 * other way leaves the proof true, and the "coming" mark stays until the row is changed. Every piece
 * of copy names its capabilities, and a piece that names one that is coming is marked (`coming`).
 *
 * A file a coming proof names is the one its step adds, by name, so the row's test fails at the merge
 * that brings that file and not before (SEO R2-N3). CC-28's merge flipped its four rows this way; the
 * Agency Plus request's template (CC-29) flipped `agency_plus_reply`. CC-31's merge flipped the five
 * it built (seats, client reports, the client matrix, exports, the agency workspace) and gave the
 * three it did not (the report page on your domain, your own sender address, the one-pager) a proof
 * that still holds beside its routes.
 */
import { ALL_SHOWN, NOJS_FIX_TYPES, type Features } from '../features';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { AGENCIES_COPY as COPY, SAMPLE_AGENCY, type Tagged } from '../copy/agencies';
import { AGENCY_PLUS_INBOX_ADDRESS } from '../copy/contact-inbox';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { dayMonth } from '../format';
import { toneOf } from '../letters';
import { CHECKS } from '../recordings';
import { buildPublicSnapshot, headline, openFixRows } from '../reports/build-snapshot';
import { AI_READABILITY_LABEL } from './result';
import { numberWord } from '../words';
import { FOOTER_LINE_CAPABILITIES } from '../copy/footer-line';
import { CAPABILITIES, type CapabilityKey } from './capabilities';

export { CAPABILITIES, type Capability, type CapabilityKey, type Proof } from './capabilities';

export interface TaggedView {
  text: string;
  capabilities: readonly CapabilityKey[];
  /** It names a feature the Goal 1 switch hides, so no page shows it. */
  hidden: boolean;
  /** It names a capability that is not built, so the page marks it "coming". */
  coming: boolean;
}

const isComing = (keys: readonly CapabilityKey[]) =>
  keys.some((k) => CAPABILITIES[k].status === 'coming');

/** Whether copy naming these capabilities names a feature `features` hides. */
export const isHidden = (keys: readonly CapabilityKey[], features: Features = ALL_SHOWN) =>
  keys.some((k) => {
    const risk = CAPABILITIES[k].risk;
    if (risk === undefined) return false;
    return (typeof risk === 'string' ? [risk] : risk).some((r) => !features[r]);
  });

/** A list of tagged copy without what the switch hides. */
export const shown = <T extends { hidden: boolean }>(items: readonly T[]): T[] =>
  items.filter((i) => !i.hidden);

/** Tags copy with `hidden` computed from `features`, the record a server entry point read. */
export const taggedWith =
  (features: Features) =>
  ({ text, capabilities }: Tagged): TaggedView => ({
    text,
    capabilities,
    coming: isComing(capabilities),
    hidden: isHidden(capabilities, features),
  });

/** Tags copy with nothing hidden. */
export const tagged = taggedWith(ALL_SHOWN);

/**
 * The "coming" label for the shared footer's line (components/v2/footer-links.ts), or null once what
 * it names is built (SEO R2-N2). A page that marks capabilities passes it to its PageShell.
 */
export function footerComing(): string | null {
  const keys = FOOTER_LINE_CAPABILITIES.map((k) => {
    if (!Object.hasOwn(CAPABILITIES, k))
      throw new Error(`the footer line names ${k}, not a capability`);
    return k as CapabilityKey;
  });
  return isComing(keys) ? COPY.coming : null;
}

/**
 * "$4 a site" when the price divides evenly; otherwise "under $N", N the next whole dollar, which
 * is true of any share that is not a whole number.
 */
export function perSitePhrase(price: number, sites: number): string {
  const each = price / sites;
  return Number.isInteger(each) ? usd(each) : `under ${usd(Math.ceil(each))}`;
}

/** "25 Oct 2026". */
const dayMonthYear = (ts: string) => `${dayMonth(ts, 'UTC')} ${new Date(ts).getUTCFullYear()}`;

export interface AgenciesView {
  title: string;
  description: string;
  h1: string;
  hero: TaggedView[];
  trial: TaggedView & { href: string };
  trialNote: TaggedView;
  /** Set while V2_BILLING is off: the sentence, with the inbox, in place of the trial's note. */
  opensSoon: { before: string; address: string; after: string } | null;
  prospect: { title: TaggedView; lines: TaggedView[]; formLabel: string; homeLink: string };
  onePager: {
    title: TaggedView;
    sub: TaggedView;
    label: string;
    capabilities: readonly CapabilityKey[];
    coming: boolean;
    hidden: boolean;
    agency: string;
    meta: string;
    heading: string;
    grades: {
      label: string;
      letter: string | null;
      score: number | null;
      withheld: boolean;
      tone: 'default' | 'bad';
    }[];
    fixesCaption: string;
    fixes: { key: string; n: number; title: string; points: string }[];
    estimates: string;
    footer: string;
  };
  compare: {
    title: string;
    columns: [string, string, string];
    rows: { key: string; label: TaggedView; pro: string; agency: string }[];
  };
  uses: { title: string; steps: TaggedView[] };
  cost: { title: string; lines: TaggedView[]; compare: { label: string; href: string } };
  comingLabel: string;
  /** The footer line's "coming" label (`footerComing`). */
  footerComing: string | null;
}

/** The address of the agency trial (CC-29 D3) and of the plans. */
export const AGENCY_TRIAL_HREF = '/agency-trial';
export const PRICING_HREF = '/pricing';

function onePager(features: Features): AgenciesView['onePager'] {
  const tag = taggedWith(features);
  const d = fixture('bad-site');
  const check = findCheck(d, CHECKS.badFirstAudit);
  const s = buildPublicSnapshot(d, check.id, check.finished_at!);
  const o = COPY.onePager;
  // `nojs` hidden: no fix whose type is a without-JavaScript finding (`NOJS_FIX_TYPES`).
  const nojsFixes = new Set(
    fixesAsOf(d, check)
      .filter((f) => NOJS_FIX_TYPES.has(f.type))
      .map((f) => f.id),
  );
  const fixRows = openFixRows(d, check).filter((r) => features.nojs || !nojsFixes.has(r.key));
  // The client report page's path: the host without its last label (example-outfitter.com → example-outfitter).
  const slug = s.host.replace(/\.[^.]+$/, '');
  return {
    title: tag(o.title),
    sub: tag(o.sub),
    label: o.label,
    capabilities: o.capabilities,
    coming: isComing(o.capabilities),
    hidden: isHidden(o.capabilities, features),
    agency: SAMPLE_AGENCY.name,
    meta: `${SAMPLE_AGENCY.host} · ${dayMonthYear(s.checkedAt)}`,
    // `nojs` hidden: the headline without its empty-without-JavaScript sentence.
    heading: `${s.host}: ${features.nojs ? s.headline : headline(check, s.host, false)}`,
    // Without the AI readability letter (`ai_letter` hidden) the sample shows Technical SEO alone.
    grades: s.grades
      .filter((g) => features.ai_letter || g.label !== AI_READABILITY_LABEL)
      .map((g) => ({
        label: g.label,
        letter: g.letter,
        score: g.score,
        withheld: g.withheld,
        tone: g.letter ? toneOf(g.letter) : 'default',
      })),
    fixesCaption: o.fixesCaption(fixRows.length),
    fixes: fixRows.map((f, i) => ({
      key: f.title,
      n: i + 1,
      title: f.scope ? `${f.title}, ${f.scope}` : f.title,
      points: f.points,
    })),
    estimates: o.estimates,
    footer: o.footer(`${SAMPLE_AGENCY.host}/${slug}`),
  };
}

/** The flags the page's first button follows: V2_BILLING, V2_AGENCY_SALES and V2_ACCOUNT_DOOR. */
export interface AgenciesFlags {
  billing: boolean;
  /**
   * `agencySalesOpen()`. The trial is offered only with this and `billing` both on; otherwise the
   * page reads as with billing off (F-251), since the checkout refuses Agency and `/agency-trial`
   * redirects here.
   */
  agencySales: boolean;
  accountDoor: boolean;
}

export function agenciesView(flags: AgenciesFlags, features: Features = ALL_SHOWN): AgenciesView {
  const tagged = taggedWith(features);
  const onSale = flags.billing && flags.agencySales;
  const pro = GATES.pro;
  const agency = GATES.agency;
  const price = usd(AGENCY_MONTHLY);
  const check = findCheck(fixture('bad-site'), CHECKS.badFirstAudit);
  const aiCrawlers = check.crawlers.filter((c) => c.group !== 'search_engine').length;
  const r = COPY.compare.rows;
  const none = COPY.compare.none;
  const row = (
    key: keyof typeof r,
    values: { pro: string; agency: string },
  ): AgenciesView['compare']['rows'][number] => ({ key, label: tagged(r[key]), ...values });
  const branded = (key: 'domain' | 'sender' | 'onePagers' | 'reports' | 'matrix') =>
    row(key, { pro: pro.agencyBranding ? r[key].agency : none, agency: r[key].agency });

  return {
    title: COPY.title,
    description: onSale
      ? // "branded client reports are coming" names both agency features, so either hidden drops it.
        features.agency_white_label && features.agency_domain
        ? COPY.description({ price, sites: agency.sites, days: TRIAL_DAYS })
        : COPY.descriptionUnbranded({ price, sites: agency.sites, days: TRIAL_DAYS })
      : COPY.descriptionBillingOff({ price, sites: agency.sites }),
    h1: COPY.h1,
    hero: shown([tagged(COPY.hero[0](numberWord(aiCrawlers))), tagged(COPY.hero[1]())]),
    trial: onSale
      ? { ...tagged(COPY.trial(TRIAL_DAYS)), href: AGENCY_TRIAL_HREF }
      : {
          ...tagged({ text: COPY.opensSoon.start, capabilities: ['free_audit'] }),
          href: flags.accountDoor ? '/signup' : '/login',
        },
    opensSoon: onSale
      ? null
      : {
          before: COPY.opensSoon.before,
          address: AGENCY_PLUS_INBOX_ADDRESS,
          after: COPY.opensSoon.after,
        },
    trialNote: tagged(COPY.trialNote({ days: TRIAL_DAYS, price, sites: agency.sites })),
    prospect: {
      title: tagged(COPY.prospect.title),
      lines: shown(COPY.prospect.lines.map(tagged)),
      formLabel: COPY.prospect.formLabel,
      homeLink: COPY.prospect.homeLink,
    },
    onePager: onePager(features),
    compare: {
      title: COPY.compare.title,
      columns: [
        COPY.compare.what,
        COPY.compare.plan('Pro', usd(PRO_MONTHLY)),
        COPY.compare.plan('Agency', price),
      ],
      rows: [
        row('sites', { pro: String(pro.sites), agency: String(agency.sites) }),
        row('seats', { pro: String(pro.seats), agency: String(agency.seats) }),
        row('competitors', {
          pro: String(pro.competitorsPerSite),
          agency: String(agency.competitorsPerSite),
        }),
        branded('domain'),
        branded('sender'),
        branded('onePagers'),
        branded('reports'),
        branded('matrix'),
      ].filter((r) => !r.label.hidden),
    },
    uses: { title: COPY.uses.title, steps: shown(COPY.uses.steps.map(tagged)) },
    cost: {
      title: COPY.cost.title,
      lines: shown([
        tagged(
          COPY.cost.price({
            price,
            sites: agency.sites,
            perSite: perSitePhrase(AGENCY_MONTHLY, agency.sites),
          }),
        ),
        tagged(COPY.cost.rest(numberWord(agency.seats))),
      ]),
      compare: { label: COPY.cost.compare, href: PRICING_HREF },
    },
    comingLabel: COPY.coming,
    footerComing: footerComing(),
  };
}
