// The funnel events. Keep this list and the call sites in sync; it also drives the sampling
// allow-list (analytics-sampling.ts) so a funnel event is never dropped by the cost-control sampler.
// Two cohorts: the original launch funnel (kebab-case) and the SPEC 02 conversion-spine funnel
// (snake_case). SPEC 03 fires the snake_case ones via trackRaw() until rebase, then typed track().
export const FUNNEL_EVENTS = [
  // Launch funnel
  'landing-view',
  'audit-submitted',
  'audit-completed',
  'email-captured',
  'public-share-clicked',
  'csv-download',
  'pro-upgrade',
  // SPEC 02 conversion spine (trustworthy result → wow → gap → free cure → wall → stay)
  'grade_revealed',
  'gap_viewed',
  'free_fix_viewed',
  'action_packet_copied',
  'wall_viewed',
  'upgrade_clicked',
  'checkout_started',
  'reaudit_clicked',
  'delta_viewed',
  // SPEC 04 §13 — viral loop (mint → share → claim → white-label) + attribution. One funnel; snake_case
  // like the SPEC 02 cohort. `share_completed` carries a `channel` prop (richer sibling of the launch
  // `public-share-clicked`); `referral_landing` fires when a `?ref=` landing is captured (K measurement).
  'report_minted',
  'report_claimed',
  'report_hidden',
  'whitelabel_enabled',
  'report_pdf_printed',
  'share_completed',
  'compare_viewed',
  'leaderboard_opt_in',
  'activity_feed_first_event',
  'referral_landing',
  // SPEC 05 — AI/agent-readiness funnel (§14). Fired via the typed track() path only.
  'ai_score_revealed',
  'ai_homepage_view_opened',
  'ai_whataisees_opened',
  'ai_packet_copied',
  'llms_txt_generated',
  'ai_finding_expanded',
  // §10 — the AI section on a shared public report. Distinct from `ai_score_revealed` (the audit page):
  // this one measures the VIRAL surface, where the viewer is usually not the site owner.
  'ai_report_section_viewed',
  // CC-25 — the account door. Fired by the Continue page after the sign-in POST answers, through
  // track(), so a visitor's consent decision applies: `trial_started {kind, variant}` when the first
  // login starts the no-card Pro trial, `site_added {n}` when it attaches the named first site.
  'trial_started',
  'site_added',
  // CC-22b — the public check flow. `check_started` and `check_finished` are sent from the server
  // (app/api/checks/_lib/events.ts); the other four go through track(), so a visitor's consent
  // decision applies.
  'home_viewed',
  'check_started',
  'check_finished',
  'result_viewed',
  'fix_opened',
  'keep_clicked',
  // CC-26b — the signed-in product (ARCH-2 §8), sent from the server (lib/v2/account/events.ts):
  // `fix_marked_done {type}` from mark done, and `fix_closed {type, checksToClose}` when a check
  // verifies a fix. Its re-checks and first checks send CC-22b's `check_started {trigger, check_ref}`.
  'fix_marked_done',
  'fix_closed',
  // CC-27b — the account's identity and exit. Sent from the server (lib/v2/account/account-events.ts),
  // keyed by the account's id, with no address: the email change applied, and a deletion requested,
  // confirmed, restored and purged.
  'account_email_changed',
  'account_deletion_requested',
  'account_deletion_confirmed',
  'account_restored',
  'account_purged',
  // CC-31 — the agency's workspace (lib/v2/agency/events.ts), sent from the server and keyed by the
  // account's id, with no address and no host. ARCH-2 §8 names `seat_invited`, `report_generated`
  // and `share_link_opened`; the other seven are this step's.
  'seat_invited',
  'seat_accepted',
  'report_generated',
  'report_downloaded',
  'report_shared',
  'share_link_opened',
  'proof_viewed',
  'first_client_added',
  'first_client_report_sent',
  'seats_bought',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
