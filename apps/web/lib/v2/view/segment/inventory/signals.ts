import { entry, type SegmentInventoryEntry } from './types';

/** What the Signals segment reads from the check. */
export const SIGNALS_INVENTORY: SegmentInventoryEntry[] = [
  entry(
    'signals-found',
    ['signals'],
    'Each signal: present, absent or not tested, where we looked, whether it counts',
    [
      'checks[].signals[].state',
      'checks[].signals[].evidence',
      'checks[].signals[].counts_toward_grade',
    ],
  ),
  entry('signals-weight', ['signals'], 'What the signals are worth in the AI readability grade', [
    'checks[].ai_readability.components.signals.max',
  ]),
  entry('signals-checked', ['signals'], 'When the signals were checked', ['checks[].tested_at']),
  entry('signals-competitor', ['signals'], 'The competitor’s host and figures', [
    'checks[].competitors[].host',
    'checks[].competitors[].crawlers_with_access',
    'checks[].competitors[].crawlers_tested',
    'checks[].competitors[].text_share',
    'checks[].competitors[].technical_seo',
  ]),
  entry('signals-own', ['signals'], 'This site’s figures beside the competitor’s', [
    'checks[].crawlers[].verdict',
    'checks[].without_js.site_text_share',
    'checks[].technical_seo.score',
    'checks[].ai_readability.total',
  ]),
];
