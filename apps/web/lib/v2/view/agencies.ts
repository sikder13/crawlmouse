/**
 * For agencies as data (CC-29 D4): the artboard's copy with its prices from `prices.ts`, its limits
 * from `GATES`, and its one-pager preview from the bad-site fixture's first audit through
 * `buildPublicSnapshot`, the builder the public report uses.
 *
 * `CAPABILITIES` is the table of every capability the pages that sell name (For agencies, Pricing and
 * the Agency trial page), with whether it is on main and the proof of it. A built capability's proof
 * is the file that does it. A coming one's proof is something `agencies.test.ts` checks against the
 * tree: the file its step will add is absent, a pattern the code that would do it has to contain is
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
import { FOOTER_LINE_CAPABILITIES } from '../copy/footer-line';

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
  | 'client_matrix'
  | 'fix_packets'
  | 'slack_alerts'
  | 'exports'
  | 'staging'
  | 'renders'
  | 'trial_reminder'
  | 'renewal_reminders'
  | 'agency_plus_reply'
  | 'agency_workspace'
  | 'observed_crawlers'
  | 'evidence_condensed';

/** Paths are from the repository root. */
export type Proof =
  /** Built: the file that does it. */
  | { kind: 'exists'; path: string }
  /** Coming: the file or folder the step that builds it adds; absent today. */
  | { kind: 'absent'; path: string }
  /** Coming: a file whose text says it is not done. */
  | { kind: 'holds'; path: string; text: string }
  /**
   * Coming: no source file under `dirs` (tests, test support and this file aside) holds `text`, a
   * string or a pattern.
   */
  | { kind: 'nowhere'; dirs: readonly string[]; text: string | RegExp }
  /** Coming: each of these proofs holds, so the first of them to fail flips the row. */
  | { kind: 'all'; of: readonly Proof[] };

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

/** Where a coming capability's code would be: the app, its jobs and the crawl worker. */
const SOURCE_DIRS = ['apps/web/lib', 'apps/web/app', 'inngest', 'packages/worker/src'] as const;

/** Where v2 mail templates live (CC-28's folder), one file per kind of email. */
const MAIL_TEMPLATES = 'apps/web/lib/v2/mail/templates';

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
    what: 'The 14-day Agency trial with the card taken at Checkout, consent recorded (CC-03, CC-29).',
    proof: { kind: 'exists', path: 'apps/web/app/api/agency-trial/route.ts' },
  },
  cancel: {
    status: 'built',
    what: 'Cancelling the plan from Settings (CC-03).',
    proof: { kind: 'exists', path: 'apps/web/app/api/billing/cancel/route.ts' },
  },
  seats: {
    status: 'built',
    what: 'Inviting people to seats beyond the owner, by email, with a role and the clients a seat covers (POST /api/seats, CC-31).',
    proof: { kind: 'exists', path: 'apps/web/app/api/seats/route.ts' },
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
    status: 'built',
    what: 'Checks on a schedule: weekly on Pro and Agency, monthly on Free’s one site (CC-28’s scheduler, `claim_due_sites`).',
    proof: { kind: 'exists', path: 'apps/web/lib/v2/monitor/schedule.ts' },
  },
  change_emails: {
    status: 'built',
    what: 'The email when a check finds a change, per the rules under Alerts: CC-28’s alert.',
    proof: { kind: 'exists', path: `${MAIL_TEMPLATES}/alert.ts` },
  },
  client_report_page: {
    status: 'coming',
    what: 'Reports and the client report page under your own name: on your domain, with your logo. The report a client opens is on our domain, names no agency and shows no logo.',
    // CC-31 built the report a client opens (`/s/<token>`), on our domain and with no logo: what
    // the client is shown is drawn here, and nothing here reads a logo.
    proof: {
      kind: 'nowhere',
      dirs: ['apps/web/app/s', 'apps/web/components/v2/screens/proof'],
      text: /logo/i,
    },
    named:
      /client report page|on your domain|your logo|under Branding|under (?:your|their) (?:own )?name|shown on client reports/i,
  },
  sender_address: {
    status: 'coming',
    what: 'Emails from your own address, with its records verified in Settings: every v2 email is sent from one address of ours.',
    proof: {
      kind: 'holds',
      path: 'apps/web/lib/v2/mail/headers.ts',
      text: 'export const MAIL_FROM = `Crawlmouse <${ALERTS_SENDER}>`;',
    },
    named: /your address|sender address|\bDKIM\b/i,
  },
  one_pagers: {
    status: 'coming',
    what: 'The branded one-pager made from an audit: the report generator makes four kinds, and the one-pager is not one of them.',
    proof: {
      kind: 'holds',
      path: 'apps/web/lib/v2/reports/generate-run.ts',
      text: "kind: z.enum(['audit_pdf', 'compare', 'raw_export', 'client_report']),",
    },
    named: /one-pager|one-page summary/i,
  },
  client_reports: {
    status: 'built',
    what: 'Client reports sent on a schedule to a contact who confirmed, naming the agency (CC-31’s hourly run).',
    proof: { kind: 'exists', path: 'apps/web/lib/v2/agency/schedules-run.ts' },
  },
  client_matrix: {
    status: 'built',
    what: 'The client matrix, every client site on one screen (/agency, CC-31).',
    proof: { kind: 'exists', path: 'apps/web/app/agency/page.tsx' },
  },
  fix_packets: {
    status: 'built',
    what: 'Each fix with its copy-paste packet (GET /api/fixes/[id]/packet).',
    proof: { kind: 'exists', path: 'apps/web/app/api/fixes/[id]/packet/route.ts' },
  },
  slack_alerts: {
    status: 'built',
    what: 'Alerts posted to the account’s Slack webhook: CC-28’s alert, through `slackPoster`.',
    proof: { kind: 'exists', path: 'apps/web/lib/v2/monitor/slack.ts' },
  },
  exports: {
    status: 'built',
    what: 'Exporting an audit as a PDF, and its pages as CSV, JSON or an edge list (POST /api/reports, CC-31).',
    proof: { kind: 'exists', path: 'apps/web/app/api/reports/route.ts' },
  },
  staging: {
    status: 'coming',
    what: 'Auditing a staging or preview URL before a deploy: a staging host is stored, but no check is requested for a deploy.',
    proof: { kind: 'nowhere', dirs: SOURCE_DIRS, text: /trigger:\s*['"]deploy['"]/ },
    named: /staging|preview URLs?|before you deploy/i,
  },
  renders: {
    status: 'coming',
    what: 'Full JavaScript renders counted against the plan’s monthly allowance: the pipeline runs with no render budget.',
    proof: {
      kind: 'holds',
      path: 'apps/web/lib/v2/pipeline/functions.ts',
      text: 'daily: NO_DAILY_BUDGET,',
    },
    named: /\brenders\b|JavaScript renders?|full renders?/i,
  },
  trial_reminder: {
    status: 'built',
    what: 'The email three days before a trial ends: CC-28’s trial reminder.',
    proof: { kind: 'exists', path: `${MAIL_TEMPLATES}/trial-reminder.ts` },
  },
  renewal_reminders: {
    status: 'coming',
    what: 'The emails 45 and 20 days before an annual renewal: no step builds their template yet.',
    proof: { kind: 'absent', path: `${MAIL_TEMPLATES}/renewal-reminder.ts` },
    named: /renewal reminders?|before an annual renewal/i,
  },
  agency_plus_reply: {
    status: 'built',
    what: 'An Agency Plus request mailed to the inbox the reply comes from: the `agency_plus_contact` template.',
    proof: { kind: 'exists', path: `${MAIL_TEMPLATES}/agency-plus-contact.ts` },
  },
  observed_crawlers: {
    status: 'coming',
    what: 'The crawlers seen visiting your own site (observed activity): nothing reads a site’s visits yet.',
    proof: { kind: 'nowhere', dirs: SOURCE_DIRS, text: 'observed_activity' },
    named: /observed activity|crawlers it has seen|seen on your site/i,
  },
  evidence_condensed: {
    status: 'coming',
    what: 'Condensing old evidence to headers and the parts of pages that changed: no job does it; evidence is kept whole.',
    proof: {
      kind: 'nowhere',
      dirs: [
        'inngest',
        'packages/worker/src',
        'packages/engine/src',
        'apps/web/app/api',
        'apps/web/lib/v2/pipeline',
        'apps/web/lib/v2/monitor',
      ],
      text: /condens/i,
    },
    named: /condensed|older than \d+ days/i,
  },
  agency_workspace: {
    status: 'built',
    what: 'The agency workspace, where an agency account’s sites are added and audited (/agency, CC-31).',
    proof: { kind: 'exists', path: 'apps/web/app/agency/page.tsx' },
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
  /** The footer line's "coming" label (`footerComing`). */
  footerComing: string | null;
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
    footerComing: footerComing(),
  };
}
