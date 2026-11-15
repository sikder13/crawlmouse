/**
 * The data dictionary of the funnel events (CC-41 D6): for each name in FUNNEL_EVENTS, who sends it,
 * under which distinct id, with which properties, and behind which consent gate. It is read by
 * scripts/ops/posthog/render.ts, which writes docs/analytics/events.md from it, and by the PostHog
 * spec's tests (survey triggers). Nothing in the app reads it at run time.
 *
 * `file` is the file, under apps/web, that writes the event's name at its send (analytics-registry
 * .test.ts checks that it does). An event with no sender is one no source file names.
 */
import type { FunnelEvent } from './analytics-events';

export type EventName = FunnelEvent;

/** Who the event is about: DISTINCT_ID_KINDS says what each kind is. */
export type DistinctId =
  | { kind: 'browser' }
  | { kind: 'user' }
  | { kind: 'owner' }
  | { kind: 'visitor'; fallback: string }
  | { kind: 'account'; fallback: string };

/** What lets the event be sent: CONSENT_GATES says what each gate is. */
export type ConsentGate = 'browser' | 'request' | 'no_request';

export const DISTINCT_ID_KINDS: Record<DistinctId['kind'], string> = {
  browser:
    "the browser's PostHog id, which becomes the person's `users.id` once a signed-in page identifies the browser",
  user: 'the `users.id` of the human who acted',
  owner: "the `users.id` of the account's owner",
  visitor:
    "the signed-in human's `users.id`, else the browser's PostHog id from its consented cookie, else the fallback shown",
  account: 'the id shown, which names the account or the check, not a person',
};

export const CONSENT_GATES: Record<ConsentGate, string> = {
  browser: 'posthog-js capture, which sends nothing while capture is opted out',
  request: "`serverCaptureAllowed` on the request's `Cookie` header (lib/consent.ts)",
  no_request:
    'a step, cron or webhook with no request: `serverCaptureAllowed` is given no cookie, so no visitor’s decision is read',
};

export interface Sender {
  side: 'browser' | 'server';
  file: string;
  distinctId: DistinctId;
  consent: ConsentGate;
  properties: readonly string[];
}

export interface EventEntry {
  senders: readonly Sender[];
  /** SURVEY_TRIGGERS says what each value means. */
  surveyTrigger?: SurveyTrigger;
}

export type SurveyTrigger = 'also' | 'only';

export const SURVEY_TRIGGERS: Record<SurveyTrigger, string> = {
  also: 'a survey trigger, counted like any other event',
  only: 'a survey trigger and nothing else (ruling Q11): `pnpm --filter @crawlmouse/scripts exec vitest run ops/posthog/spec.test.ts` fails when an action, cohort or insight counts it',
};

const browser = (file: string, properties: readonly string[] = []): Sender => ({
  side: 'browser',
  file,
  distinctId: { kind: 'browser' },
  consent: 'browser',
  properties,
});

const server = (
  file: string,
  distinctId: Exclude<DistinctId, { kind: 'browser' }>,
  consent: Exclude<ConsentGate, 'browser'>,
  properties: readonly string[] = [],
): Sender => ({ side: 'server', file, distinctId, consent, properties });

const USER = { kind: 'user' } as const;
const OWNER = { kind: 'owner' } as const;
const visitor = (fallback: string) => ({ kind: 'visitor', fallback }) as const;
const account = (fallback: string) => ({ kind: 'account', fallback }) as const;

const PAYMENT = 'lib/billing/payment-events.ts';
const REPORT_PROPS = ['kind', 'format'] as const;
const CHECK_STARTED = ['trigger', 'check_ref'] as const;

export const EVENT_REGISTRY: Record<EventName, EventEntry> = {
  'landing-view': {
    senders: [browser('app/page.tsx'), browser('app/ai-readiness-checker/AiReadinessChecker.tsx')],
  },
  'audit-submitted': { senders: [browser('components/audit/UrlForm.tsx', ['domain'])] },
  'audit-completed': {
    senders: [
      browser('app/audit/[id]/AuditView.tsx', [
        'status',
        'grade',
        'score',
        'confidence',
        'coveragePct',
        'blockRate',
        'partial',
      ]),
    ],
  },
  'email-captured': {
    senders: [browser('lib/notify-submit.ts', ['source']), browser('app/login/LoginForm.tsx')],
  },
  'public-share-clicked': { senders: [browser('components/share/SharePanel.tsx', ['slug'])] },
  'csv-download': { senders: [browser('app/audit/[id]/AuditSurfaceView.tsx', ['auditId'])] },
  'pro-upgrade': { senders: [browser('components/billing/ActivatingPro.tsx')] },
  grade_revealed: { senders: [browser('app/audit/[id]/AuditView.tsx', ['grade'])] },
  gap_viewed: { senders: [] },
  free_fix_viewed: { senders: [] },
  action_packet_copied: {
    senders: [browser('components/audit/ActionPacketCopy.tsx', ['fixId'])],
  },
  wall_viewed: { senders: [] },
  upgrade_clicked: { senders: [browser('components/billing/UpgradeLink.tsx', ['returnTo'])] },
  checkout_started: { senders: [] },
  reaudit_clicked: { senders: [browser('components/dashboard/ReauditButton.tsx', ['auditId'])] },
  delta_viewed: { senders: [] },
  report_minted: {
    senders: [
      browser('lib/mint-share.ts', ['slug']),
      server('lib/v2/reports/mint-deps.ts', USER, 'request', ['kind']),
    ],
  },
  report_claimed: { senders: [browser('components/report/owner/ClaimControl.tsx', ['slug'])] },
  report_hidden: {
    senders: [browser('components/report/owner/owner-controls-logic.ts', ['slug'])],
  },
  whitelabel_enabled: {
    senders: [browser('components/report/owner/WhiteLabelControls.tsx', ['slug'])],
  },
  report_pdf_printed: { senders: [browser('components/report/PrintButton.tsx')] },
  share_completed: {
    senders: [browser('components/share/ShareSurface.tsx', ['channel', 'grade'])],
  },
  compare_viewed: { senders: [browser('app/compare/[a]/[b]/page.tsx')] },
  leaderboard_opt_in: {
    senders: [
      browser('components/report/owner/owner-controls-logic.ts', ['slug']),
      browser('components/report/owner/WhiteLabelVisibilityPrompt.tsx', ['slug']),
    ],
  },
  activity_feed_first_event: { senders: [browser('app/audit/[id]/AuditView.tsx')] },
  referral_landing: { senders: [browser('lib/share-url.ts', ['source'])] },
  ai_score_revealed: {
    senders: [browser('components/ai/AiReadinessSection.tsx', ['score', 'band', 'confidence'])],
  },
  ai_homepage_view_opened: { senders: [browser('components/ai/AiReadinessSection.tsx')] },
  ai_whataisees_opened: { senders: [browser('components/ai/AiReadinessSection.tsx')] },
  ai_packet_copied: { senders: [browser('components/ai/AiPacketCopy.tsx', ['fixId'])] },
  llms_txt_generated: { senders: [browser('components/ai/LlmsTxtGenerator.tsx')] },
  ai_finding_expanded: { senders: [browser('components/ai/AiReadinessSection.tsx', ['kind'])] },
  ai_report_section_viewed: {
    senders: [browser('components/report/AiReadinessReportSection.tsx', ['band', 'confidence'])],
  },
  trial_started: {
    senders: [
      // Named by the first login; the Continue page sends it (ContinueScreen.tsx).
      browser('lib/auth/first-login.ts', ['kind', 'variant']),
      server('app/api/billing/pro-trial/start/route.ts', USER, 'request', ['kind', 'variant']),
      server('app/api/agency-trial/_lib/start.ts', USER, 'request', ['kind', 'variant', 'stage']),
    ],
  },
  site_added: {
    senders: [
      browser('lib/auth/first-login.ts', ['n']),
      server('app/api/sites/route.ts', USER, 'request', ['n']),
    ],
  },
  home_viewed: { senders: [browser('components/v2/screens/home/LiveHome.tsx')] },
  check_started: {
    senders: [
      server('app/api/checks/route.ts', visitor('check:<ref>'), 'request', CHECK_STARTED),
      server('app/api/sites/route.ts', USER, 'request', CHECK_STARTED),
      server('app/api/sites/[id]/checks/route.ts', USER, 'request', CHECK_STARTED),
      server('lib/v2/account/fixes.ts', USER, 'request', CHECK_STARTED),
    ],
  },
  check_finished: {
    senders: [
      server('app/api/checks/[id]/_lib/deps.ts', visitor('check:<ref>'), 'request', [
        'trigger',
        'status',
        'pages',
        'durationMs',
        'seo',
        'aiReadability',
        'withheld',
        'check_ref',
      ]),
      server(
        'lib/v2/mail/handlers.ts',
        account('account:<id>, or check:<ref> for a check no account keeps'),
        'no_request',
        ['trigger', 'status', 'check_ref', 'source'],
      ),
    ],
  },
  result_viewed: {
    senders: [browser('app/audit/[id]/_lib/CheckPage.tsx', ['variant', 'check_ref'])],
    surveyTrigger: 'also',
  },
  fix_opened: {
    senders: [browser('app/audit/[id]/_lib/ReadyPage.tsx', ['type', 'free', 'check_ref'])],
  },
  keep_clicked: {
    senders: [browser('components/v2/screens/result/KeepBar.tsx', ['from', 'check_ref'])],
  },
  fix_marked_done: { senders: [server('lib/v2/account/fixes.ts', USER, 'request', ['type'])] },
  fix_closed: {
    senders: [
      server('lib/v2/pipeline/persist.ts', account('account:<id>'), 'no_request', [
        'type',
        'checksToClose',
      ]),
    ],
  },
  account_email_changed: {
    senders: [server('lib/v2/account/email-change.ts', USER, 'request', ['tier'])],
  },
  account_deletion_requested: {
    senders: [server('lib/v2/account/deletion.ts', USER, 'request', ['tier'])],
  },
  account_deletion_confirmed: {
    senders: [server('lib/v2/account/deletion.ts', USER, 'request', ['tier', 'accounts'])],
  },
  account_restored: { senders: [server('lib/v2/account/deletion.ts', USER, 'request', ['tier'])] },
  account_purged: {
    senders: [
      server('lib/v2/account/deletion-purge.ts', account('account:<id>'), 'no_request', ['counts']),
    ],
  },
  seat_invited: {
    senders: [server('lib/v2/agency/seats.ts', USER, 'request', ['role', 'scoped'])],
  },
  seat_accepted: { senders: [server('lib/v2/agency/seats.ts', USER, 'request', ['role'])] },
  report_generated: {
    senders: [server('app/api/reports/route.ts', USER, 'request', REPORT_PROPS)],
  },
  report_downloaded: {
    senders: [server('app/api/report-files/[id]/download/route.ts', USER, 'request', REPORT_PROPS)],
  },
  report_shared: { senders: [server('lib/v2/reports/share.ts', USER, 'request', REPORT_PROPS)] },
  share_link_opened: {
    senders: [server('lib/v2/reports/share.ts', visitor('account:<id>'), 'request', REPORT_PROPS)],
  },
  proof_viewed: {
    senders: [
      server('app/reports/[id]/page.tsx', USER, 'request', ['via']),
      server('app/s/view/[reportId]/page.tsx', visitor('account:<id>'), 'request', ['via']),
    ],
  },
  first_client_added: {
    senders: [
      server('app/api/sites/route.ts', USER, 'request'),
      server('app/api/agency-trial/route.ts', USER, 'request'),
    ],
  },
  first_client_report_sent: {
    senders: [
      server('lib/v2/agency/schedules-run.ts', account('account:<id>'), 'no_request'),
      server('lib/v2/mail/handlers.ts', account('account:<id>'), 'no_request'),
    ],
  },
  seats_bought: {
    senders: [server('app/api/billing/seats/route.ts', USER, 'request', ['seats', 'sites'])],
  },
  alert_sent: {
    senders: [
      server('lib/v2/monitor/functions.ts', account('account:<id>'), 'no_request', [
        'channel',
        'changes',
      ]),
    ],
  },
  summary_sent: {
    senders: [
      server('lib/v2/monitor/functions.ts', account('account:<id>'), 'no_request', [
        'sites',
        'changes',
      ]),
    ],
  },
  unsubscribed: {
    senders: [server('app/api/unsubscribe/route.ts', visitor('seat:<id>'), 'request', ['kind'])],
  },
  pricing_viewed: {
    senders: [
      server('app/v2-pricing/page.tsx', visitor('anon:<random uuid>'), 'request', [
        'interval',
        'signedIn',
      ]),
    ],
  },
  plan_chosen: {
    senders: [server('app/api/agency-trial/_lib/start.ts', USER, 'request', ['plan', 'interval'])],
  },
  report_viewed: {
    senders: [
      server('app/api/reports/[slug]/view/route.ts', visitor('report:<slug>'), 'request', ['kind']),
    ],
  },
  subscription_started: {
    senders: [
      server(PAYMENT, OWNER, 'no_request', [
        'plan',
        'interval',
        'trial',
        'amount_cents',
        'currency',
      ]),
    ],
  },
  trial_converted: { senders: [server(PAYMENT, OWNER, 'no_request', ['plan'])] },
  plan_changed: { senders: [server(PAYMENT, OWNER, 'no_request', ['from', 'to'])] },
  subscription_canceled: {
    senders: [server(PAYMENT, OWNER, 'no_request', ['plan', 'at_period_end'])],
  },
  subscription_ended: { senders: [server(PAYMENT, OWNER, 'no_request', ['plan'])] },
  payment_failed: { senders: [server(PAYMENT, OWNER, 'no_request', ['plan', 'attempt'])] },
  fix_done_confirmed: {
    senders: [browser('components/v2/screens/site/MarkDone.tsx', ['type'])],
    surveyTrigger: 'only',
  },
};
