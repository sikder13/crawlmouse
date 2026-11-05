import type { Check, SignalKind } from '@crawlmouse/types/v2';

/**
 * The agent signals the locked screens show, in their order. The contract carries more: the four
 * declaration files the crawl worker records by path (CC-12d: `ucp`, `rsl`, `agent_card`,
 * `llms_full`), at zero weight. Showing those is a screen step of its own, so the screens count and
 * list only these, and a check's other results do not reach them.
 */
export const SCREEN_SIGNALS = [
  'schema_org',
  'content_signals',
  'web_bot_auth',
  'llms_txt',
  'mcp_server_card',
  'markdown_negotiation',
  'agent_skills_index',
] as const satisfies readonly SignalKind[];

export type ScreenSignal = (typeof SCREEN_SIGNALS)[number];

type SignalResult = Check['signals'][number];

/** A check's results for the signals the screens show. */
export const screenSignals = (check: Check): (SignalResult & { signal: ScreenSignal })[] =>
  check.signals.filter((s): s is SignalResult & { signal: ScreenSignal } =>
    (SCREEN_SIGNALS as readonly SignalKind[]).includes(s.signal),
  );
