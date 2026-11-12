/**
 * The words of For agencies (CC-29 D4), from Final-Agencies with FACTS Part 2 applied: A1 (AI
 * readability), A2 (Pro has two seats), A5 ("estimated" on first appearance), A7 ("client report
 * page"), C4 (SPF, DKIM and a DMARC record). Prices come from `prices.ts` and limits from `GATES`,
 * passed in by `lib/v2/view/agencies.ts`; nothing here types either.
 *
 * Each piece of copy carries the capabilities it names (`capabilities`), which the view checks
 * against its table of what is built; a capability that is not built is marked "coming" wherever it
 * is named. Changes from the artboard, and why:
 * - The h1 no longer promises "an audit with your name on it": branded audits are not built, and a
 *   heading is the one place a "coming" mark cannot sit. It says what Agency does today.
 * - The hero note drops "5 seats": inviting a seat is not built, and the comparison table, where
 *   seats are marked, says it.
 * - The one-pager preview drops the competitor's grade: competitors are stored but not measured.
 */
import type { CapabilityKey } from '../view/agencies';

export interface Tagged {
  text: string;
  capabilities: readonly CapabilityKey[];
}

/** The sample agency of the one-pager preview (FACTS: Summit Digital is a sample agency). */
export const SAMPLE_AGENCY = { name: 'Summit Digital', host: 'audits.summitdigital.co' } as const;

export const AGENCIES_COPY = {
  title: 'For agencies',
  description: (p: { price: string; sites: number; days: number }) =>
    `Audit a prospect’s site free before the first call. Agency is ${p.price} a month for ${p.sites} client sites, with a ${p.days}-day trial; branded client reports are coming.`,
  h1: 'Audit a prospect’s site before the first call.',
  hero: [
    (crawlers: string): Tagged => ({
      text: `Crawlmouse audits any site in about two minutes, as ${crawlers} AI crawlers.`,
      capabilities: ['free_audit'],
    }),
    (): Tagged => ({
      text: 'Agency puts that audit on your domain, under your logo, with a one-page summary you can attach to a proposal, and re-checks every client site weekly so the report to them writes itself.',
      capabilities: ['client_report_page', 'one_pagers', 'weekly_checks', 'client_reports'],
    }),
  ],
  trial: (days: number): Tagged => ({
    text: `Start a ${days}-day trial`,
    capabilities: ['agency_trial'],
  }),
  trialNote: (p: { days: number; price: string; sites: number }): Tagged => ({
    text: `Card required; nothing charged for ${p.days} days, then ${p.price} a month · ${p.sites} client sites · cancel any day, two clicks`,
    capabilities: ['agency_trial', 'sites', 'cancel'],
  }),
  prospect: {
    title: { text: 'Try it on a prospect’s site now, free.', capabilities: ['free_audit'] },
    lines: [
      { text: 'The audit is complete without an account.', capabilities: ['free_audit'] },
      { text: 'The branded one-pager comes with Agency.', capabilities: ['one_pagers'] },
    ],
    formLabel: 'Audit a prospect’s site',
    /** While public checks are off the audit form has no route to post to: v1's home audits. */
    homeLink: 'Audit it from the home page',
  },
  onePager: {
    title: {
      text: 'The prospect one-pager, as the client receives it',
      capabilities: ['one_pagers'],
    },
    sub: {
      text: 'Made from any public audit in one click. Your logo, your domain, your sender address.',
      capabilities: ['one_pagers', 'client_report_page', 'sender_address'],
    },
    label: `Preview · ${SAMPLE_AGENCY.name}, a sample agency`,
    /** Its capabilities: the whole preview is the one-pager on the client report page. */
    capabilities: ['one_pagers', 'client_report_page'],
    fixesCaption: 'Three fixes, effects estimated',
    estimates: 'Effects are estimates from the audit’s formula.',
    footer: (path: string) =>
      `Full audit with evidence, on your client report page: ${path} · Prepared by ${SAMPLE_AGENCY.name}`,
  },
  compare: {
    title: 'Agency against Pro',
    /** The first column's header, read out but not drawn (the artboard leaves it blank). */
    what: 'What you get',
    plan: (name: string, price: string) => `${name} · ${price}`,
    none: '—',
    rows: {
      sites: { text: 'Sites', capabilities: ['sites'] },
      seats: { text: 'Seats', capabilities: ['seats'] },
      competitors: { text: 'Competitors per site', capabilities: ['competitors'] },
      domain: {
        text: 'Reports and client report pages on your domain, your logo',
        capabilities: ['client_report_page'],
        agency: 'CNAME, verified in Settings',
      },
      sender: {
        text: 'Emails from your address',
        capabilities: ['sender_address'],
        agency: 'SPF, DKIM and a DMARC record, verified in Settings',
      },
      onePagers: {
        text: 'Prospect one-pagers',
        capabilities: ['one_pagers'],
        agency: 'from any audit you run',
      },
      reports: {
        text: 'Scheduled client reports, sent for you',
        capabilities: ['client_reports'],
        agency: 'on a schedule you set',
      },
      matrix: {
        text: 'Client matrix',
        capabilities: ['client_matrix'],
        agency: 'every client on one screen',
      },
    },
  },
  uses: {
    title: 'How agencies use it',
    steps: [
      {
        text: 'Audit a prospect’s site, free, before the first call. Attach the one-pager to the proposal.',
        capabilities: ['free_audit', 'one_pagers'],
      },
      {
        text: 'Won the work? Add the site; it is checked weekly and the client gets a report from you, on your domain, on the schedule you set.',
        capabilities: ['sites', 'weekly_checks', 'client_reports', 'client_report_page'],
      },
      {
        text: 'When a check finds a change, you hear first: a plugin update that blocked ClaudeBot, a template that stopped rendering. The email is yours to forward or act on.',
        capabilities: ['change_emails'],
      },
    ],
  },
  cost: {
    title: 'What it costs against doing it by hand',
    price: (p: { price: string; sites: number; perSite: string }): Tagged => ({
      text: `${p.price} a month for ${p.sites} sites is ${p.perSite} a site a month.`,
      capabilities: ['sites'],
    }),
    rest: (seats: string): Tagged => ({
      text: `Each is checked weekly, with the client report written for you; there is no per-report fee and no per-seat fee up to ${seats}.`,
      capabilities: ['weekly_checks', 'client_reports', 'seats'],
    }),
    compare: 'Compare all plans',
  },
  /** The mark beside a capability that is not built. */
  coming: 'coming',
} as const;
