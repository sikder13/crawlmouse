/**
 * For agencies as data (CC-29 D4): the artboard's copy with its prices from `prices.ts`, its limits
 * from `GATES`, and its one-pager preview from the bad-site fixture's first audit through
 * `buildPublicSnapshot`, the builder the public report uses.
 *
 * `CAPABILITIES` is the table of every capability the page names, with whether it is on main and
 * the proof of it. A built capability's proof is the file that does it; a coming one's proof is
 * something `agencies.test.ts` can check is still true: the file its step will add is absent, or the
 * code that would do it says it does not yet. When that step lands, the proof fails, and the page's
 * "coming" mark is taken off with it. Every piece of copy names its capabilities, and a piece that
 * names one that is coming is marked (`coming`).
 */
import { TRIAL_DAYS } from '../../billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { AGENCIES_COPY as COPY, SAMPLE_AGENCY, type Tagged } from '../copy/agencies';
import { findCheck, fixture } from '../fixtures';
import { dayMonth } from '../format';
import { toneOf } from '../letters';
import { CHECKS } from '../recordings';
import { buildPublicSnapshot } from '../reports/build-snapshot';
import { numberWord } from '../words';

export type CapabilityKey =
  | 'free_audit'
  | 'sites'
  | 'agency_trial'
  | 'cancel'
  | 'seats'
  | 'competitors'
  | 'weekly_checks'
  | 'change_emails'
  | 'client_report_page'
  | 'sender_address'
  | 'one_pagers'
  | 'client_reports'
  | 'client_matrix';

/** Paths are from the repository root. */
export type Proof =
  /** Built: the file that does it. */
  | { kind: 'exists'; path: string }
  /** Coming: the file or folder the step that builds it adds; absent today. */
  | { kind: 'absent'; path: string }
  /** Coming: a file whose text says it is not done. */
  | { kind: 'holds'; path: string; text: string }
  /** Coming: no source file under `dirs` (tests, test support and this file aside) holds `text`. */
  | { kind: 'nowhere'; dirs: readonly string[]; text: string };

export interface Capability {
  status: 'built' | 'coming';
  /** What it is, in a sentence. */
  what: string;
  proof: Proof;
  /**
   * For a coming capability: what names it in the page's text, so a mention outside the copy that
   * carries its key is found (`agencies-screen.test.tsx`).
   */
  named?: RegExp;
}

export const CAPABILITIES: Readonly<Record<CapabilityKey, Capability>> = {
  free_audit: {
    status: 'built',
    what: 'An audit of any public site, free and without an account (POST /api/checks).',
    proof: { kind: 'exists', path: 'apps/web/app/api/checks/route.ts' },
  },
  sites: {
    status: 'built',
    what: "Adding sites up to the plan's limit (POST /api/sites, the site limit from GATES).",
    proof: { kind: 'exists', path: 'apps/web/app/api/sites/route.ts' },
  },
  agency_trial: {
    status: 'built',
    what: 'The 14-day Agency trial with the card taken at Checkout (CC-03).',
    proof: { kind: 'exists', path: 'apps/web/app/api/billing/agency-trial/route.ts' },
  },
  cancel: {
    status: 'built',
    what: 'Cancelling the plan from Settings (CC-03).',
    proof: { kind: 'exists', path: 'apps/web/app/api/billing/cancel/route.ts' },
  },
  seats: {
    status: 'coming',
    what: 'Inviting people to seats beyond the owner; seats are CC-31’s.',
    proof: { kind: 'absent', path: 'apps/web/app/api/billing/seats' },
    named: /\bseats?\b/i,
  },
  competitors: {
    status: 'coming',
    what: 'Measuring competitors: a site stores them, but the check builder records none.',
    proof: {
      kind: 'holds',
      path: 'packages/engine/src/v2/build/record.ts',
      text: 'competitors: [],',
    },
    named: /competitor/i,
  },
  weekly_checks: {
    status: 'coming',
    what: 'Checks on a schedule: nothing requests a scheduled check yet (CC-28).',
    proof: {
      kind: 'nowhere',
      dirs: ['apps/web/lib', 'apps/web/app', 'inngest'],
      text: "trigger: 'scheduled'",
    },
    named: /checked weekly|re-checks/i,
  },
  change_emails: {
    status: 'coming',
    what: 'The email when a check finds a change: the mailer is CC-28’s.',
    proof: { kind: 'absent', path: 'apps/web/lib/v2/mail' },
    named: /finds a change|hear first/i,
  },
  client_report_page: {
    status: 'coming',
    what: 'Reports and the client report page on your domain, under your logo: CC-31.',
    proof: { kind: 'absent', path: 'apps/web/app/s' },
    named: /client report page|on your domain|your logo/i,
  },
  sender_address: {
    status: 'coming',
    what: 'Emails from your own address, with its records verified in Settings: CC-31.',
    proof: { kind: 'absent', path: 'apps/web/app/agency' },
    named: /your address|sender address|\bDKIM\b/i,
  },
  one_pagers: {
    status: 'coming',
    what: 'The branded one-pager made from an audit: CC-31.',
    proof: { kind: 'absent', path: 'apps/web/app/agency' },
    named: /one-pager|one-page summary/i,
  },
  client_reports: {
    status: 'coming',
    what: 'Client reports sent on a schedule: CC-31.',
    proof: { kind: 'absent', path: 'apps/web/app/api/report-files' },
    named: /client reports?\b(?! page)|report to them|report from you/i,
  },
  client_matrix: {
    status: 'coming',
    what: 'The client matrix, every client site on one screen: CC-31.',
    proof: { kind: 'absent', path: 'apps/web/app/agency' },
    named: /client matrix|every client on one screen/i,
  },
};

export interface TaggedView {
  text: string;
  capabilities: readonly CapabilityKey[];
  /** It names a capability that is not built, so the page marks it "coming". */
  coming: boolean;
}

const isComing = (keys: readonly CapabilityKey[]) =>
  keys.some((k) => CAPABILITIES[k].status === 'coming');

export const tagged = ({ text, capabilities }: Tagged): TaggedView => ({
  text,
  capabilities,
  coming: isComing(capabilities),
});

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
  prospect: { title: TaggedView; lines: TaggedView[]; formLabel: string; homeLink: string };
  onePager: {
    title: TaggedView;
    sub: TaggedView;
    label: string;
    capabilities: readonly CapabilityKey[];
    coming: boolean;
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
}

/** The address of the agency trial (CC-29 D3) and of the plans. */
export const AGENCY_TRIAL_HREF = '/agency-trial';
export const PRICING_HREF = '/pricing';

function onePager(): AgenciesView['onePager'] {
  const d = fixture('bad-site');
  const check = findCheck(d, CHECKS.badFirstAudit);
  const s = buildPublicSnapshot(d, check.id, check.finished_at!);
  const o = COPY.onePager;
  // The client report page's path: the host without its last label (example-outfitter.com → example-outfitter).
  const slug = s.host.replace(/\.[^.]+$/, '');
  return {
    title: tagged(o.title),
    sub: tagged(o.sub),
    label: o.label,
    capabilities: o.capabilities,
    coming: isComing(o.capabilities),
    agency: SAMPLE_AGENCY.name,
    meta: `${SAMPLE_AGENCY.host} · ${dayMonthYear(s.checkedAt)}`,
    heading: `${s.host}: ${s.headline}`,
    grades: s.grades.map((g) => ({
      label: g.label,
      letter: g.letter,
      score: g.score,
      withheld: g.withheld,
      tone: g.letter ? toneOf(g.letter) : 'default',
    })),
    fixesCaption: o.fixesCaption,
    fixes: s.topFixes.map((f, i) => ({
      key: f.title,
      n: i + 1,
      title: f.scope ? `${f.title}, ${f.scope}` : f.title,
      points: f.points,
    })),
    estimates: o.estimates,
    footer: o.footer(`${SAMPLE_AGENCY.host}/${slug}`),
  };
}

export function agenciesView(): AgenciesView {
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
    description: COPY.description({ price, sites: agency.sites, days: TRIAL_DAYS }),
    h1: COPY.h1,
    hero: [tagged(COPY.hero[0](numberWord(aiCrawlers))), tagged(COPY.hero[1]())],
    trial: { ...tagged(COPY.trial(TRIAL_DAYS)), href: AGENCY_TRIAL_HREF },
    trialNote: tagged(COPY.trialNote({ days: TRIAL_DAYS, price, sites: agency.sites })),
    prospect: {
      title: tagged(COPY.prospect.title),
      lines: COPY.prospect.lines.map(tagged),
      formLabel: COPY.prospect.formLabel,
      homeLink: COPY.prospect.homeLink,
    },
    onePager: onePager(),
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
      ],
    },
    uses: { title: COPY.uses.title, steps: COPY.uses.steps.map(tagged) },
    cost: {
      title: COPY.cost.title,
      lines: [
        tagged(
          COPY.cost.price({
            price,
            sites: agency.sites,
            perSite: perSitePhrase(AGENCY_MONTHLY, agency.sites),
          }),
        ),
        tagged(COPY.cost.rest(numberWord(agency.seats))),
      ],
      compare: { label: COPY.cost.compare, href: PRICING_HREF },
    },
    comingLabel: COPY.coming,
  };
}
