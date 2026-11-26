/**
 * The table of every capability the pages that sell name (For agencies, Pricing and the Agency trial
 * page), with whether it is on main and the proof of it. The proof rules are described at the top of
 * `agencies.ts`, which re-exports everything here.
 *
 * This module imports nothing at run time, so a module that needs only the table (the dashboard) does
 * not pull in what `agencies.ts` builds its page from: the fixtures, the recordings and the snapshot
 * builder (`dashboard-imports.test.ts`).
 */
import type { RiskFeature } from '../../feature-switch';

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
  /**
   * The Goal 1 switch names that hide it while unproven (`lib/feature-switch.ts`): one name, or a
   * list, any of which hides it.
   */
  risk?: RiskFeature | readonly RiskFeature[];
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
    risk: 'competitors',
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
    // Row 24 names the client page and row 25 the agency's domain; this names both.
    risk: ['agency_white_label', 'agency_domain'],
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
    risk: 'agency_domain',
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
    risk: 'agency_white_label',
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
    risk: 'agency_white_label',
    what: 'Client reports sent on a schedule to a contact who confirmed, naming the agency (CC-31’s hourly run).',
    proof: { kind: 'exists', path: 'apps/web/lib/v2/agency/schedules-run.ts' },
  },
  client_matrix: {
    status: 'built',
    risk: 'agency_white_label',
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
    risk: 'staging_deploys',
    what: 'Auditing a staging or preview URL before a deploy: a staging host is stored, but no check is requested for a deploy.',
    proof: { kind: 'nowhere', dirs: SOURCE_DIRS, text: /trigger:\s*['"]deploy['"]/ },
    named: /staging|preview URLs?|before you deploy/i,
  },
  renders: {
    status: 'coming',
    risk: 'rendering',
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
