/**
 * The spike's second Fly run (2026-10-27, run 40577051856), discriminators scenario: per site and
 * crawler, how many sampled pages produced each verdict. Copied from the run's results artifact. The
 * run recorded these counts only, not the responses behind them, and it classified with the spike's
 * rules.
 */
export const FLY_RUN_2 = {
  date: '2026-10-27',
  run: 'https://github.com/sikder13/crawlmouse/actions/runs/40577051856',
  counts: {
    'nike.com': {
      'OAI-SearchBot': { redirected_away: 1, refused_unverified: 19 },
      'ChatGPT-User': { redirected_away: 1, refused_unverified: 19 },
      PerplexityBot: { redirected_away: 1, refused_unverified: 19 },
      'Claude-SearchBot': { redirected_away: 1, refused_unverified: 19 },
      GPTBot: { redirected_away: 1, refused_unverified: 19 },
      ClaudeBot: { redirected_away: 1, refused_unverified: 19 },
    },
    'en.wikipedia.org': {
      'OAI-SearchBot': { allowed: 17, disallowed_by_robots: 3 },
      'ChatGPT-User': { allowed: 17, disallowed_by_robots: 3 },
      PerplexityBot: { allowed: 17, disallowed_by_robots: 3 },
      'Claude-SearchBot': { allowed: 17, disallowed_by_robots: 3 },
      GPTBot: { allowed: 17, disallowed_by_robots: 3 },
      ClaudeBot: { allowed: 17, disallowed_by_robots: 3 },
    },
    'css-tricks.com': {
      'OAI-SearchBot': { blocked_by_ua_rule: 16, allowed: 4 },
      'ChatGPT-User': { blocked_by_ua_rule: 16, allowed: 4 },
      PerplexityBot: { blocked_by_ua_rule: 16, allowed: 4 },
      'Claude-SearchBot': { blocked_by_ua_rule: 16, allowed: 4 },
      GPTBot: { blocked_by_ua_rule: 16, allowed: 4 },
      ClaudeBot: { blocked_by_ua_rule: 16, allowed: 4 },
    },
    'neilpatel.com': {
      'OAI-SearchBot': { edge_blocks_automation: 1 },
      'ChatGPT-User': { edge_blocks_automation: 1 },
      PerplexityBot: { edge_blocks_automation: 1 },
      'Claude-SearchBot': { edge_blocks_automation: 1 },
      GPTBot: { edge_blocks_automation: 1 },
      ClaudeBot: { edge_blocks_automation: 1 },
    },
    'cnn.com': {
      'OAI-SearchBot': { edge_blocks_automation: 2, allowed: 11, disallowed_by_robots: 7 },
      'ChatGPT-User': {
        edge_blocks_automation: 2,
        blocked_by_ua_rule: 11,
        disallowed_by_robots: 7,
      },
      PerplexityBot: { edge_blocks_automation: 2, blocked_by_ua_rule: 11, disallowed_by_robots: 7 },
      'Claude-SearchBot': { edge_blocks_automation: 2, allowed: 11, disallowed_by_robots: 7 },
      GPTBot: { edge_blocks_automation: 2, blocked_by_ua_rule: 11, disallowed_by_robots: 7 },
      ClaudeBot: { edge_blocks_automation: 2, blocked_by_ua_rule: 11, disallowed_by_robots: 7 },
    },
  },
} as const;
