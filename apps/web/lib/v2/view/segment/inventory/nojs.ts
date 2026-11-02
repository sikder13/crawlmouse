import { entry, type SegmentInventoryEntry } from './types';

/** What Readable without JavaScript reads from the check. */
export const NOJS_INVENTORY: SegmentInventoryEntry[] = [
  entry(
    'nojs-site-share',
    ['nojs'],
    'Text without JavaScript, site-wide: the pill and the first tile',
    ['checks[].without_js.site_text_share'],
  ),
  entry(
    'nojs-rows',
    ['nojs'],
    'Each measured page: its words without and with JavaScript, share and state',
    [
      'page_results[].without_js.raw_words',
      'page_results[].without_js.rendered_words',
      'page_results[].without_js.text_share',
      'page_results[].without_js.state',
      'page_results[].sampled',
    ],
  ),
  entry(
    'nojs-measured',
    ['nojs'],
    'The measured set: pages sampled, of pages found, and the sample’s limit',
    [
      'checks[].coverage.pages_sampled',
      'checks[].coverage.pages_discovered',
      'checks[].coverage.sample_strategy.max_pages',
    ],
  ),
  entry('nojs-template', ['nojs'], 'Pages sharing the thin template', [
    'checks[].coverage.templates[].pages',
  ]),
  entry(
    'nojs-readers',
    ['nojs'],
    'Which AI crawlers read the server’s HTML, and which are still kept out',
    ['checks[].crawlers[].verdict'],
  ),
  entry(
    'nojs-evidence',
    ['nojs'],
    'What the server sent beside what a browser shows, for the selected page',
    ['access_tests[].body_excerpt', 'access_tests[].word_count', 'access_tests[].tested_at'],
  ),
  entry('nojs-tested', ['nojs'], 'When the pages were measured', ['checks[].tested_at']),
  entry('nojs-fix', ['nojs'], 'The open fix: title and effect', [
    'fixes[].title',
    'fixes[].effect',
  ]),
];
