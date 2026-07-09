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
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
